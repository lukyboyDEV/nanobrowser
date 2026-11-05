; Registers Nano as a selectable browser in Windows "Default apps" (per-user, no admin needed).
!macro customInstall
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nano" "" "Nano"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nano\Capabilities" "ApplicationName" "Nano"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nano\Capabilities" "ApplicationDescription" "Nano - a fast, private browser by VANTA"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nano\Capabilities\URLAssociations" "http" "NanoURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nano\Capabilities\URLAssociations" "https" "NanoURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nano\Capabilities\FileAssociations" ".html" "NanoURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nano\Capabilities\FileAssociations" ".htm" "NanoURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nano\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  WriteRegStr HKCU "Software\Classes\NanoURL" "" "Nano URL"
  WriteRegStr HKCU "Software\Classes\NanoURL" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\NanoURL\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\NanoURL\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\RegisteredApplications" "Nano" "Software\Clients\StartMenuInternet\Nano\Capabilities"
!macroend
!macro customUnInstall
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Nano"
  DeleteRegKey HKCU "Software\Classes\NanoURL"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Nano"
!macroend
