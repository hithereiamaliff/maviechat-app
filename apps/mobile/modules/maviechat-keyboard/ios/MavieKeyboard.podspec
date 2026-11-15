Pod::Spec.new do |s|
  s.name           = 'MavieKeyboard'
  s.version        = '1.0.0'
  s.summary        = 'Keyboard commands for MavieChat on an iPad'
  s.description    = 'Return sends from the message box while a keyboard is attached, and the web app shortcuts.'
  s.author         = 'TechMavie Digital'
  s.homepage       = 'https://github.com/hithereiamaliff/maviechat-app'
  s.license        = { type: 'MIT' }
  # The same floor as ExpoModulesCore (SDK 58), and Swift 5 mode like most of Expo's own modules.
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
