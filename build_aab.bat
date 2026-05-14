@echo off
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.10.7-hotspot"
cd /d "%~dp0android"
call gradlew.bat bundleRelease
