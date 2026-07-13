# Funtastic SMS Bridge

Internal Android APK that forwards only PicklePlus verification SMS messages to the connected Funtastic SaaS workspace.

Build requirements: JDK 17 and Android SDK 35.

```bash
./gradlew assembleRelease
```

The first internal release uses Android's default debug keystore so it can be installed immediately. Replace it with an organization-owned release keystore before distributing outside the company.
