@echo off
REM ============================================================
REM  أمر معالجة RealityScan — يستدعيه agent.ps1 تلقائيًا.
REM  يمكنك تعديل الأوامر هنا للتحكم بالجودة والتصدير.
REM
REM  المعطيات:  %1 = مجلد الصور   %2 = ملف الإخراج   %3 = الجودة
REM ============================================================

set "PHOTOS=%~1"
set "OUT=%~2"
set "QUALITY=%~3"

REM مسار RealityScan — عدّله إن كان مختلفًا
set "RS=C:\Program Files\Epic Games\RealityScan\RealityScan.exe"

REM اختيار أمر بناء الشبكة حسب الجودة
set "MODELCMD=-calculateNormalModel"
if /I "%QUALITY%"=="high" set "MODELCMD=-calculateHighModel"
if /I "%QUALITY%"=="low"  set "MODELCMD=-calculatePreviewModel"

REM تسلسل المعالجة: إضافة الصور ← محاذاة ← تحديد المنطقة ← بناء الشبكة
REM   ← تبسيط إلى 200 ألف مثلث (مناسب للطباعة) ← تصدير OBJ ← خروج.
REM ملاحظة: "" في -exportModel تعني «صدّر النموذج النشط الحالي».
%RS% -headless ^
  -addFolder "%PHOTOS%" ^
  -align ^
  -setReconstructionRegionAuto ^
  %MODELCMD% ^
  -simplify 200000 ^
  -exportModel "" "%OUT%" ^
  -quit

exit /b %ERRORLEVEL%
