import { bilibiliVideo, rawMaterialUrl, youtubeId, type DtMaterial } from '@maviechat/deeptutor-protocol';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { openLink } from '@/lib/links';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/** Pages the players link to (YouTube's own, a channel…) open in the browser, not over the player. */
const elsewhere = {
  onShouldStartLoadWithRequest: (request: { url: string; isTopFrame?: boolean; navigationType?: string }) => {
    if (request.isTopFrame === false || request.navigationType !== 'click') return true;
    void openLink(request.url);
    return false;
  },
  onOpenWindow: (event: { nativeEvent: { targetUrl: string } }) => void openLink(event.nativeEvent.targetUrl),
};

/** What the reader can ask of the player. */
export interface MediaPlayerHandle {
  /** Plays from `seconds`. */
  seek(seconds: number): void;
  pause(): void;
}

interface PlayerProps {
  ref?: Ref<MediaPlayerHandle>;
  /** Seconds to start at. */
  start: number;
  /** The position and length, about twice a second while it plays (players that can tell). */
  onTime?: (seconds: number, duration: number) => void;
  /** Playing, or paused or ended (just after the last time). */
  onPlaying?: (playing: boolean) => void;
}

/** YouTube's own player in a page of ours: it reports the time, and seeks when asked. */
function youtubePage(id: string, start: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>html,body{margin:0;height:100%;background:#000}#player{position:absolute;inset:0;width:100%;height:100%}</style></head><body><div id="player"></div>
<script>
function post(m){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(m));}
var player;
function now(){return{time:player.getCurrentTime(),duration:player.getDuration()};}
function onYouTubeIframeAPIReady(){player=new YT.Player('player',{host:'https://www.youtube-nocookie.com',videoId:${JSON.stringify(id)},width:'100%',height:'100%',playerVars:{playsinline:1,rel:0,start:${Math.floor(start)}},events:{onStateChange:function(e){if(e.data===1)post({playing:true});else if(e.data===2||e.data===0){var m=now();m.playing=false;post(m);}},onError:function(e){post({error:e.data});}}});}
setInterval(function(){if(player&&player.getPlayerState&&player.getPlayerState()===1)post(now());},500);
window.seekTo=function(t){if(player&&player.seekTo){player.seekTo(t,true);player.playVideo();}};
</script><script src="https://www.youtube.com/iframe_api"></script></body></html>`;
}

function YouTubePlayer({ ref, id, start, onTime, onPlaying }: PlayerProps & { id: string }) {
  const palette = usePalette();
  const view = useRef<WebView<object>>(null);
  const [error, setError] = useState<number | null>(null);
  // The page is made once: seeking happens inside it.
  const [html] = useState(() => youtubePage(id, start));
  useImperativeHandle(
    ref,
    () => ({
      seek: (seconds) => view.current?.injectJavaScript(`window.seekTo(${Math.max(0, seconds)});true;`),
      pause: () => view.current?.injectJavaScript('if(player&&player.pauseVideo)player.pauseVideo();true;'),
    }),
    [],
  );
  return (
    <View style={styles.video}>
      <WebView<object>
        ref={view}
        // An https origin (YouTube won't play in a page without one), and not DeepTutor's: YouTube's
        // script runs in this page, and has no business with your DeepTutor sign-in.
        source={{ html, baseUrl: 'https://www.youtube.com' }}
        originWhitelist={['*']}
        {...elsewhere}
        allowsInlineMediaPlayback
        // Tapping a line of the transcript plays from there.
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo
        javaScriptEnabled
        style={styles.fill}
        onMessage={(event) => {
          try {
            const message = JSON.parse(event.nativeEvent.data) as { time?: number; duration?: number; playing?: boolean; error?: number };
            if (typeof message.time === 'number') onTime?.(message.time, message.duration ?? 0);
            if (typeof message.playing === 'boolean') onPlaying?.(message.playing);
            if (typeof message.error === 'number') setError(message.error);
          } catch {
            // Not ours.
          }
        }}
      />
      {error !== null ? (
        <View style={[styles.cover, { backgroundColor: palette.surface }]}>
          <Text style={[styles.coverText, { color: palette.textMuted }]}>
            {error === 101 || error === 150
              ? "The video's owner doesn't let it play outside YouTube. Use Watch on YouTube in the menu."
              : error === 100
                ? 'YouTube says this video is private or was removed.'
                : "YouTube couldn't play this video here. Use Watch on YouTube in the menu."}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Bilibili's player. It can't tell the time or take orders: seeking (or pausing) loads it again at the time. */
function BilibiliPlayer({ ref, bvid, part, start }: PlayerProps & { bvid: string; part: number }) {
  const [load, setLoad] = useState({ at: Math.floor(start), play: false, count: 0 });
  useImperativeHandle(
    ref,
    () => ({
      seek: (seconds) => setLoad((last) => ({ at: Math.floor(Math.max(0, seconds)), play: true, count: last.count + 1 })),
      // It may be playing from its own button, unseen: loaded again, it's still.
      pause: () => setLoad((last) => ({ ...last, play: false, count: last.count + 1 })),
    }),
    [],
  );
  const src = `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&p=${part}&t=${load.at}&autoplay=${load.play ? 1 : 0}&high_quality=1`;
  return (
    <View style={styles.video}>
      <WebView<object>
        key={load.count}
        source={{ html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style></head><body><iframe src="${src}" allowfullscreen allow="autoplay; fullscreen"></iframe></body></html>`, baseUrl: 'https://www.bilibili.com' }}
        originWhitelist={['*']}
        {...elsewhere}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo
        style={styles.fill}
      />
    </View>
  );
}

/** A video or audio file you uploaded, played from DeepTutor by the system player. */
function FilePlayer({ ref, materialId, audio, start, onTime, onPlaying }: PlayerProps & { materialId: string; audio: boolean }) {
  const { session } = useDtAuthed();
  const started = useRef(false);
  const player = useVideoPlayer({ uri: rawMaterialUrl(session.baseUrl, materialId), headers: { Authorization: `Bearer ${session.token}` } }, (created) => {
    created.timeUpdateEventInterval = 0.5;
  });
  useEventListener(player, 'timeUpdate', ({ currentTime }) => onTime?.(currentTime, player.duration));
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (!isPlaying) onTime?.(player.currentTime, player.duration);
    onPlaying?.(isPlaying);
  });
  // Start where you were, once it can play.
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status !== 'readyToPlay' || started.current) return;
    started.current = true;
    if (start > 0) player.seekBy(start - player.currentTime);
  });
  useImperativeHandle(
    ref,
    () => ({
      seek: (seconds) => {
        player.seekBy(Math.max(0, seconds) - player.currentTime);
        player.play();
      },
      pause: () => player.pause(),
    }),
    [player],
  );
  return <VideoView player={player} nativeControls contentFit="contain" style={audio ? styles.audio : styles.video} />;
}

/**
 * The player above a video's transcript: YouTube's, Bilibili's, or the system player for a file
 * you uploaded. YouTube and files report the time, so the transcript can follow along.
 */
export function MediaPlayer({ material, ...props }: PlayerProps & { material: DtMaterial }) {
  const palette = usePalette();
  if (material.kind === 'youtube') {
    const id = youtubeId(material.sourceUrl);
    if (id) return <YouTubePlayer id={id} {...props} />;
  }
  if (material.kind === 'bilibili') {
    const video = bilibiliVideo(material.sourceUrl);
    if (video) return <BilibiliPlayer bvid={video.bvid} part={video.part} {...props} />;
  }
  if (material.renderMode === 'video' || material.renderMode === 'audio' || material.kind === 'video' || material.kind === 'audio') {
    if (material.kind !== 'youtube' && material.kind !== 'bilibili') return <FilePlayer materialId={material.id} audio={material.renderMode === 'audio' || material.kind === 'audio'} {...props} />;
  }
  return (
    <View style={[styles.cover, styles.video, { backgroundColor: palette.surface }]}>
      <Text style={[styles.coverText, { color: palette.textMuted }]}>This video can&apos;t be played in the app. Open it from the menu.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  audio: { width: '100%', height: 90, backgroundColor: '#000' },
  fill: { flex: 1, backgroundColor: '#000' },
  cover: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 20, borderRadius: radius.md },
  coverText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
