; Voxtory - Inno Setup Script

[Setup]
AppName=Voxtory
AppId=Voxtory
AppVersion=1.0.0
AppPublisher=Voxtory
WizardStyle=modern dynamic
DefaultDirName={autopf}\Voxtory
DefaultGroupName=Voxtory
UninstallDisplayIcon={app}\Voxtory.exe
Compression=lzma2
SolidCompression=yes
OutputDir=Output
OutputBaseFilename=Voxtory_Setup
PrivilegesRequired=admin
MinVersion=10.0

[Languages]
Name: en; MessagesFile: "compiler:Default.isl"

[Files]
Source: "dist\Voxtory\*"; DestDir: "{app}"; Excludes: "piper_data\*"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "dist\Voxtory\piper_data\*"; DestDir: "{commonappdata}\piper_data"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Voxtory"; Filename: "{app}\Voxtory.exe"
Name: "{autodesktop}\Voxtory"; Filename: "{app}\Voxtory.exe"

[Run]
Filename: "{app}\Voxtory.exe"; Flags: nowait postinstall skipifsilent
