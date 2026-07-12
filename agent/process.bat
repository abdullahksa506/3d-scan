@echo off
REM ============================================================
REM  RealityScan processing command - called by agent.ps1.
REM  Edit the commands here to control quality and export.
REM
REM  Args:  %1 = photos folder   %2 = output file
REM         %3 = quality         %4 = RealityScan.exe path
REM ============================================================

set "PHOTOS=%~1"
set "OUT=%~2"
set "QUALITY=%~3"
set "RS=%~4"

REM fall back to the default path if none was passed
if "%RS%"=="" set "RS=C:\Program Files\Epic Games\RealityScan\RealityScan.exe"

REM pick the mesh command based on quality
set "MODELCMD=-calculateNormalModel"
if /I "%QUALITY%"=="high" set "MODELCMD=-calculateHighModel"
if /I "%QUALITY%"=="low"  set "MODELCMD=-calculatePreviewModel"

REM add photos -> align -> auto region -> build mesh -> simplify to 200k
REM triangles -> calculate texture (color) -> export textured GLB -> quit.
REM appQuitOnError makes RealityScan close (not hang) if anything fails.
"%RS%" -headless ^
  -set "appQuitOnError=true" ^
  -addFolder "%PHOTOS%" ^
  -align ^
  -setReconstructionRegionAuto ^
  %MODELCMD% ^
  -simplify 200000 ^
  -calculateTexture ^
  -exportSelectedModel "%OUT%" ^
  -quit

exit /b %ERRORLEVEL%
