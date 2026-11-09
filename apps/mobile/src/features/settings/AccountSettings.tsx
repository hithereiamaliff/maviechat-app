import {
  acceptedProfileImage,
  createApiKey,
  DEFAULT_PROFILE_IMAGE,
  deleteApiKey,
  getApiKey,
  getUserVariables,
  gravatarUrl,
  hasOwnPicture,
  maskSecret,
  OwuiHttpError,
  profileOf,
  updatePassword,
  updateProfile,
  updateUserVariables,
  validBirthDate,
  variablesProblem,
  type Profile,
  type SessionUser,
  type Variable,
} from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MenuTrigger, type MenuItem } from '@/components/Menu';
import { TextField } from '@/components/TextField';
import { useToast } from '@/components/Toast';
import { initials, UserAvatar } from '@/components/UserAvatar';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useServerConfig, useSessionUser } from '@/lib/server';
import { useSession } from '@/session/SessionProvider';
import { fonts, radius, usePalette } from '@/theme';
import { initialsColour, usePictureMaker } from './PictureMaker';
import { ActionRow, Group, Note, rowStyles, SectionTitle } from './rows';
import { TwoStepSection } from './TwoStepSection';
import { VariableEditor } from './VariableEditor';

const GENDERS = [
  { value: '', label: 'Prefer not to say' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
] as const;
const isListedGender = (gender: string) => GENDERS.some((option) => option.value === gender);

const PHOTO: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.7,
  base64: true,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

/**
 * Open WebUI's Account tab: your picture, name, bio, gender and birth date and your own variables
 * (saved together with Save, as on the web), your password, your two-step sign-in where the server
 * asks for it (0.12), and your API key when the admin allows one.
 */
export function AccountSettings() {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useAuthed();
  const { expireSession } = useSession();
  const queryClient = useQueryClient();
  const capabilities = useCapabilities();
  const config = useServerConfig();
  const user = useSessionUser();
  const variables = useQuery({ queryKey: ['user-variables'], queryFn: () => getUserVariables(client) });
  const picture = usePictureMaker();
  const [draft, setDraft] = useState<Profile | null>(null);
  const [vars, setVars] = useState<Variable[] | null>(null);
  const [customGender, setCustomGender] = useState<boolean | null>(null);
  const [editingVariable, setEditingVariable] = useState<Variable | 'new' | null>(null);
  const [making, setMaking] = useState(false);
  const [saving, setSaving] = useState(false);

  // As on the web, the tab starts from your profile as the server has it now.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['session-user'] });
  }, [queryClient]);

  const saved = user.data ? profileOf(user.data) : null;
  const shown = draft ?? saved;
  const shownVars = vars ?? variables.data ?? [];
  const custom = customGender ?? (shown ? !isListedGender(shown.gender) : false);
  const changed = draft !== null || vars !== null;
  const edit = (change: Partial<Profile>) => {
    if (shown) setDraft({ ...shown, ...change });
  };

  if (!shown) {
    return (
      <ScrollView contentContainerStyle={rowStyles.content}>
        {user.isError ? <Note>{`Couldn’t load your account: ${describeError(user.error)}`}</Note> : <ActivityIndicator style={styles.loading} color={palette.textMuted} />}
      </ScrollView>
    );
  }

  const makePicture = async (make: () => Promise<string | null>) => {
    setMaking(true);
    try {
      const url = await make();
      if (url) edit({ profile_image_url: url });
    } catch (error) {
      toast(`Couldn’t change the picture: ${describeError(error)}`, 'error');
    } finally {
      setMaking(false);
    }
  };
  const fromPhotos = (camera: boolean) =>
    makePicture(async () => {
      if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
        toast('Allow camera access for MavieChat in Settings to take a photo.', 'error');
        return null;
      }
      const result = camera ? await ImagePicker.launchCameraAsync(PHOTO) : await ImagePicker.launchImageLibraryAsync(PHOTO);
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset?.base64) return null;
      return picture.maker.square(`data:image/jpeg;base64,${asset.base64}`);
    });
  const pictureItems: MenuItem[] = [
    { key: 'photos', label: 'Choose Photo', icon: 'photo', onPress: () => void fromPhotos(false) },
    { key: 'camera', label: 'Take Photo', icon: 'camera', onPress: () => void fromPhotos(true) },
    { key: 'initials', label: 'Use Initials', icon: 'user-circle', onPress: () => void makePicture(() => picture.maker.initials(initials(shown.name), initialsColour(shown.name))) },
    { key: 'gravatar', label: 'Use Gravatar', icon: 'globe-alt', onPress: () => void makePicture(() => gravatarUrl(client, user.data?.email ?? session.user.email)) },
    ...(hasOwnPicture(shown.profile_image_url) ? [{ key: 'remove', label: 'Remove Picture', icon: 'trash' as const, destructive: true, onPress: () => edit({ profile_image_url: DEFAULT_PROFILE_IMAGE }) }] : []),
  ];

  const submit = async () => {
    if (!shown.name.trim()) return toast('Enter your name.', 'error');
    if (!validBirthDate(shown.date_of_birth)) return toast('Enter your birth date as YYYY-MM-DD, or leave it empty.', 'error');
    if (!acceptedProfileImage(shown.profile_image_url)) return toast('Your server won’t take this picture. Choose another.', 'error');
    const problem = vars ? variablesProblem(vars) : null;
    if (problem) return toast(problem, 'error');
    setSaving(true);
    try {
      if (draft) {
        let profile = draft;
        // Initials made for your old name follow the new one, as on the web.
        if (saved && profile.name.trim() !== saved.name && profile.profile_image_url.startsWith('data:image/png')) {
          const old = await picture.maker.initials(initials(saved.name), initialsColour(saved.name)).catch(() => null);
          if (old === profile.profile_image_url) profile = { ...profile, profile_image_url: await picture.maker.initials(initials(profile.name), initialsColour(profile.name)) };
        }
        await updateProfile(client, profile);
        // On screen at once (the server answers with only some of it), then read again below.
        queryClient.setQueryData<SessionUser>(['session-user'], (old) =>
          old
            ? { ...old, name: profile.name.trim(), profile_image_url: profile.profile_image_url, bio: profile.bio.trim() || null, gender: profile.gender.trim() || null, date_of_birth: profile.date_of_birth.trim() || null }
            : old,
        );
        setDraft(null);
        setCustomGender(null);
      }
      if (vars) {
        await updateUserVariables(client, vars);
        queryClient.setQueryData(['user-variables'], vars);
        setVars(null);
      }
      await queryClient.invalidateQueries({ queryKey: ['session-user'] });
      void queryClient.invalidateQueries({ queryKey: ['user-variables'] });
      toast('Saved');
    } catch (error) {
      toast(`Couldn’t save: ${describeError(error)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const passwordForm = config.data?.features?.enable_login_form !== false && config.data?.features?.enable_password_change_form !== false;
  const apiKeys = capabilities?.feature('apiKeys') ?? false;

  return (
    <ScrollView contentContainerStyle={rowStyles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <MenuTrigger label="Change your picture" items={pictureItems}>
          <View>
            <UserAvatar name={shown.name} picture={shown.profile_image_url} size={72} />
            <View style={[styles.badge, { backgroundColor: palette.background, borderColor: palette.border }]}>
              {making ? <ActivityIndicator size="small" color={palette.textMuted} /> : <Icon name="camera" size={14} color={palette.text} />}
            </View>
          </View>
        </MenuTrigger>
        <View style={styles.who}>
          <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
            {shown.name || ' '}
          </Text>
          <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={2}>
            {[user.data?.email, user.data?.role === 'admin' ? 'Admin' : user.data?.role === 'user' ? 'User' : user.data?.role].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>

      <SectionTitle title="Profile" />
      <TextField label="Name" value={shown.name} onChangeText={(name) => edit({ name })} autoCapitalize="words" textContentType="name" />
      <TextField label="Bio" value={shown.bio} onChangeText={(bio) => edit({ bio })} multiline textAlignVertical="top" placeholder="A few words about you" style={styles.bio} />
      <Text style={[styles.label, { color: palette.textMuted }]}>Gender</Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {[...GENDERS, { value: 'custom', label: 'Custom' }].map((option) => {
          const selected = option.value === 'custom' ? custom : !custom && shown.gender === option.value;
          return (
            <Pressable
              key={option.value || 'none'}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => {
                setCustomGender(option.value === 'custom');
                edit({ gender: option.value === 'custom' ? (custom ? shown.gender : '') : option.value });
              }}
              style={[styles.chip, { borderColor: selected ? palette.text : palette.border, backgroundColor: selected ? palette.surfaceStrong : 'transparent' }]}>
              <Text style={[styles.chipText, { color: selected ? palette.text : palette.textMuted }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {custom ? (
        <TextInput
          value={shown.gender}
          onChangeText={(gender) => edit({ gender })}
          placeholder="Your gender, in your words"
          placeholderTextColor={palette.textFaint}
          accessibilityLabel="Custom gender"
          style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
        />
      ) : null}
      <TextField
        label="Birth Date"
        value={shown.date_of_birth}
        onChangeText={(date_of_birth) => edit({ date_of_birth })}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        autoCorrect={false}
      />

      <View style={styles.heading}>
        <SectionTitle title={`Your Variables${shownVars.length ? ` (${shownVars.length})` : ''}`} />
        <Pressable accessibilityRole="button" accessibilityLabel="Add a variable" onPress={() => setEditingVariable('new')} hitSlop={8} style={styles.add}>
          <Icon name="plus" size={15} color={palette.link} />
          <Text style={[styles.addText, { color: palette.link }]}>Add</Text>
        </Pressable>
      </View>
      {shownVars.length ? (
        <Group>
          {shownVars.map((variable) => (
            <ActionRow key={variable.key} label={variable.key} hint={variable.value.length > 80 ? `${variable.value.slice(0, 80)}…` : variable.value || '(empty)'} onPress={() => setEditingVariable(variable)} />
          ))}
        </Group>
      ) : null}
      <Note>{'Use them in system prompts, like {{user.variables.city}}, for things about you that models should know.'}</Note>

      <View style={styles.save}>
        <Button label="Save" loading={saving} disabled={!changed || saving || making} onPress={() => void submit()} />
      </View>

      {passwordForm ? <PasswordSection onChanged={() => void expireSession('Your password was changed. Sign in with the new one.')} /> : null}
      <TwoStepSection />
      {apiKeys ? <ApiKeySection admin={capabilities?.isAdmin ?? false} token={session.token} /> : null}

      <VariableEditor
        variable={editingVariable}
        taken={shownVars.filter((item) => editingVariable === 'new' || item.key !== editingVariable?.key).map((item) => item.key)}
        onDone={(variable) => {
          const list = shownVars.filter((item) => editingVariable === 'new' || item.key !== editingVariable?.key);
          const at = editingVariable === 'new' ? -1 : shownVars.findIndex((item) => item.key === editingVariable?.key);
          setVars(at < 0 ? [...list, variable] : [...list.slice(0, at), variable, ...list.slice(at)]);
        }}
        onDelete={() => setVars(shownVars.filter((item) => editingVariable === 'new' || item.key !== editingVariable?.key))}
        onClose={() => setEditingVariable(null)}
      />
      {picture.element}
    </ScrollView>
  );
}

/** Your password: the current one and the new one twice. The server then signs you out everywhere. */
function PasswordSection({ onChanged }: { onChanged: () => void }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    if (next !== confirm) {
      setProblem('The new passwords don’t match.');
      setNext('');
      setConfirm('');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await updatePassword(client, current, next);
      onChanged();
    } catch (error) {
      setProblem(error instanceof OwuiHttpError && error.detail ? error.detail : describeError(error));
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.heading}>
        <SectionTitle title="Password" />
        <View style={styles.add}>
          <Text style={[styles.addText, { color: palette.link }]}>{open ? 'Hide' : 'Change'}</Text>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={13} color={palette.link} />
        </View>
      </Pressable>
      {open ? (
        <View style={styles.password}>
          <TextField label="Current Password" value={current} onChangeText={setCurrent} secureTextEntry textContentType="password" autoComplete="current-password" />
          <TextField label="New Password" value={next} onChangeText={setNext} secureTextEntry textContentType="newPassword" autoComplete="new-password" />
          <TextField label="Confirm New Password" value={confirm} onChangeText={setConfirm} secureTextEntry textContentType="newPassword" autoComplete="new-password" />
          {problem ? <Text style={[styles.problem, { color: palette.danger }]}>{problem}</Text> : null}
          <Button label="Update Password" loading={busy} disabled={!current || !next || !confirm || busy} onPress={() => void submit()} />
          <Note>Every device signed in to this account is signed out, this one too. Then sign in with the new password.</Note>
        </View>
      ) : null}
    </>
  );
}

/** Your API key (one per account), and for admins this app's sign-in token, as on the web. */
function ApiKeySection({ admin, token }: { admin: boolean; token: string }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const key = useQuery({ queryKey: ['api-key'], queryFn: () => getApiKey(client) });
  const [busy, setBusy] = useState(false);

  const change = async (run: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await run();
      await queryClient.invalidateQueries({ queryKey: ['api-key'] });
      toast(done);
    } catch (error) {
      toast(`Couldn’t do that: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const create = () => {
    if (!key.data) return void change(() => createApiKey(client), 'API key created');
    Alert.alert('Create a new key?', 'Your current key stops working: anything using it needs the new one.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Create', onPress: () => void change(() => createApiKey(client), 'New API key created') },
    ]);
  };
  const remove = () =>
    Alert.alert('Delete your API key?', 'Anything using it stops working.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void change(() => deleteApiKey(client), 'API key deleted') },
    ]);
  const copy = (secret: string, what: string) => void Clipboard.setStringAsync(secret).then(() => toast(`${what} copied`));

  return (
    <>
      <SectionTitle title="API Key" />
      {key.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {key.isError ? <Note>{`Couldn’t load your key: ${describeError(key.error)}`}</Note> : null}
      {key.isSuccess ? (
        <Group>
          {key.data ? (
            <View style={styles.secret}>
              <Text style={[styles.secretText, { color: palette.text }]} numberOfLines={1}>
                {maskSecret(key.data)}
              </Text>
              <IconButton icon="clipboard-document" label="Copy API key" size={18} onPress={() => copy(key.data as string, 'API key')} />
            </View>
          ) : null}
          <ActionRow label={key.data ? 'Create New Key' : 'Create API Key'} disabled={busy} onPress={create} />
          {key.data ? <ActionRow label="Delete Key" destructive disabled={busy} onPress={remove} /> : null}
          {admin ? <ActionRow label="Copy Session Token (JWT)" hint="This app’s sign-in; it stops working when you sign out." onPress={() => copy(token, 'Token')} /> : null}
        </Group>
      ) : null}
      <Note>Lets scripts and other apps use Open WebUI as you. Keep it secret.</Note>
    </>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 24 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  badge: { position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  who: { flex: 1, gap: 3 },
  name: { fontFamily: fonts.semibold, fontSize: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 13 },
  bio: { minHeight: 80, paddingTop: 12, paddingBottom: 12 },
  label: { fontFamily: fonts.medium, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontFamily: fonts.medium, fontSize: 14 },
  input: { minHeight: 46, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 14, fontFamily: fonts.regular, fontSize: 16 },
  heading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingBottom: 1, paddingRight: 4 },
  addText: { fontFamily: fonts.medium, fontSize: 14 },
  save: { marginTop: 8 },
  password: { gap: 10 },
  problem: { fontFamily: fonts.regular, fontSize: 14 },
  secret: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 4, minHeight: 46 },
  secretText: { flex: 1, fontFamily: fonts.mono, fontSize: 14 },
});
