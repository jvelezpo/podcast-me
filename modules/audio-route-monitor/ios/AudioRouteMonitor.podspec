Pod::Spec.new do |s|
  s.name           = 'AudioRouteMonitor'
  s.version        = '1.0.0'
  s.summary        = 'Reports Bluetooth media-output route changes.'
  s.description    = 'A local Expo module used by Podcast Me to recover playback after Bluetooth route changes.'
  s.license        = { :type => 'MIT' }
  s.author         = 'Podcast Me'
  s.homepage       = 'https://expo.dev'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift}'
end
