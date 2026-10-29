import { Redirect } from 'expo-router';

/** The Vibe Map became the Hot Map. Keeps old links and deep links working. */
export default function VibeMapRedirect() {
  return <Redirect href="/hot-map" />;
}
