import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic config layered on app.json. Secrets/IDs come from the build environment (EAS env vars or .env),
 * never from source:
 *   GOOGLE_MAPS_ANDROID_API_KEY  Android Hot Map (Maps SDK for Android). iOS uses Apple Maps (no key).
 *   APP_LINK_DOMAIN              Domain for invite links (Android App Links), e.g. sniffin-navy.vercel.app
 *   IOS_UNIVERSAL_LINKS=1        Also claim the domain on iOS (needs a paid Apple Developer account; free
 *                                Personal Teams cannot sign the Associated Domains entitlement)
 *   SNIFFIN_IOS_FREE_SIGNING=1  Omit the APNs entitlement for a local iPhone build signed by a free Personal Team.
 *   GOOGLE_SERVICES_JSON         Path to google-services.json (FCM push on Android), or the file in the repo root.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const linkDomain = process.env.APP_LINK_DOMAIN || process.env.EXPO_PUBLIC_APP_LINK_DOMAIN;
  const googleServices = process.env.GOOGLE_SERVICES_JSON || (require('fs').existsSync('./google-services.json') ? './google-services.json' : undefined);
  const freeIosSigning = process.env.SNIFFIN_IOS_FREE_SIGNING === '1';
  const plugins = (config.plugins ?? []).map((plugin) => {
    if (!freeIosSigning || !Array.isArray(plugin) || plugin[0] !== 'expo-notifications') return plugin;
    return ['expo-notifications', { ...plugin[1], enableRemoteNotifications: false }] as typeof plugin;
  });
  plugins.push(['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }]);
  plugins.push('expo-status-bar');

  return {
    ...config,
    name: config.name ?? 'Sniff.in',
    slug: config.slug ?? 'sniff-in',
    plugins,
    ios: {
      ...config.ios,
      ...(linkDomain && process.env.IOS_UNIVERSAL_LINKS === '1' ? { associatedDomains: [`applinks:${linkDomain}`] } : {}),
    },
    android: {
      ...config.android,
      ...(googleServices ? { googleServicesFile: googleServices } : {}),
      ...(linkDomain
        ? {
            intentFilters: [
              {
                action: 'VIEW',
                autoVerify: true,
                data: [
                  { scheme: 'https', host: linkDomain, pathPrefix: '/join' },
                  { scheme: 'https', host: linkDomain, pathPrefix: '/@' },
                  { scheme: 'https', host: linkDomain, pathPrefix: '/post/' },
                  { scheme: 'https', host: linkDomain, pathPrefix: '/spotify/callback' },
                ],
                category: ['BROWSABLE', 'DEFAULT'],
              },
            ],
          }
        : {}),
    },
    extra: { ...config.extra, appLinkDomain: linkDomain ?? null, iosPushEnabled: !freeIosSigning },
  };
};
