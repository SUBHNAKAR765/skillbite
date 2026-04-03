@echo off
SET MAVEN_PROJECTBASEDIR=%~dp0
IF "%MAVEN_PROJECTBASEDIR:~-1%"=="\" SET MAVEN_PROJECTBASEDIR=%MAVEN_PROJECTBASEDIR:~0,-1%

SET WRAPPER_JAR=%MAVEN_PROJECTBASEDIR%\.mvn\wrapper\maven-wrapper.jar
SET JAVA_HOME=C:\Program Files\Java\jdk-22
SET JAVA_EXE=%JAVA_HOME%\bin\java.exe

IF NOT EXIST "%JAVA_EXE%" (
  echo Error: JAVA_HOME not found at %JAVA_HOME%
  EXIT /B 1
)

IF EXIST "%WRAPPER_JAR%" (
  "%JAVA_EXE%" -classpath "%WRAPPER_JAR%" "-Dmaven.multiModuleProjectDirectory=%MAVEN_PROJECTBASEDIR%" org.apache.maven.wrapper.MavenWrapperMain %*
) ELSE (
  where mvn >nul 2>&1
  IF %ERRORLEVEL%==0 (
    mvn %*
  ) ELSE (
    echo Error: maven-wrapper.jar not found and mvn not on PATH.
    EXIT /B 1
  )
)
