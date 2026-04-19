@echo off
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot"
cd /d "%~dp0android"
call gradlew.bat bundleRelease
