; Give Explorer a dedicated icon path instead of a cached executable icon.
; Only update shortcuts that point to this installation; retain the app identity.
!macro DeadlineDockRefreshShortcut SHORTCUT
  !insertmacro IsShortcutTarget "${SHORTCUT}" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    CreateShortcut "${SHORTCUT}" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\deadline-dock-brand.ico" 0
    !insertmacro SetLnkAppUserModelId "${SHORTCUT}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro DeadlineDockRefreshShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !if "${STARTMENUFOLDER}" != ""
    !insertmacro DeadlineDockRefreshShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !endif
  !insertmacro DeadlineDockRefreshShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
