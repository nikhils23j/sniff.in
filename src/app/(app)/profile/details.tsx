import { Redirect } from 'expo-router';

/** Keep old deep links working after merging Personal details into Edit profile. */
export default function PersonalDetailsRedirect() {
  return <Redirect href="/profile/edit" />;
}
