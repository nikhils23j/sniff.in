import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '@/components/story/motion';
import { Vignette } from '@/components/story/Vignette';
import { Button, Logo, Text } from '@/components/ui';
import { useTheme } from '@/theme';

type Icon = keyof typeof Ionicons.glyphMap;
type Point = { icon: Icon; title: string; body: string };

const SERVERS: Point[] = [
  { icon: 'business-outline', title: 'Ongoing communities', body: 'Stay connected to your campus, club, workplace, building, or neighbourhood.' },
  { icon: 'timer-outline', title: 'Temporary places', body: 'Join an event or venue, then choose when and what you are Open to Talk about.' },
  { icon: 'qr-code-outline', title: 'Join with real context', body: 'A QR code or invite connects you to the people who are actually there.' },
];
const ACTIVITIES: Point[] = [
  { icon: 'football-outline', title: 'Turn interests into plans', body: 'Find a game, study group, meal, trip, or casual hangout.' },
  { icon: 'people-outline', title: 'See who is joining', body: 'Activity pages show the plan, capacity, and confirmed participants.' },
  { icon: 'add-circle-outline', title: 'Make your own', body: 'Post an idea to one of your Servers and let the right people opt in.' },
];

function PointRow({ icon, title, body }: Point) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={20} color={t.colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="subheading">{title}</Text>
        <Text variant="callout" color="textSecondary">
          {body}
        </Text>
      </View>
    </View>
  );
}

export default function WelcomeScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const list = useRef<FlatList>(null);
  const [page, setPage] = useState(0);
  const reduce = useReduceMotion();
  const cardWidth = Math.min(width - 48, 340);

  const pages = [
    <View key="what" style={{ gap: 20, alignItems: 'center' }}>
      <Vignette kind="friends" width={cardWidth} animate={!reduce} />
      <View style={{ gap: 10, alignItems: 'center' }}>
        <Text variant="display" align="center">
          The social layer for the real world
        </Text>
        <Text variant="body" color="textSecondary" align="center" style={{ maxWidth: 320 }}>
          Skip the Introduction. Start the Connection.
        </Text>
      </View>
      <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 320 }}>
        Meet people who are already in the same room, on your terms: presence, context, intent and consent.
      </Text>
    </View>,
    <View key="servers" style={{ gap: 22 }}>
      <View style={{ alignItems: 'center' }}><Vignette kind="servers" width={cardWidth} animate={!reduce} /></View>
      <View style={{ gap: 6 }}><Text variant="title">Communities with context</Text><Text variant="callout" color="textSecondary">Servers organise the people and places you already share.</Text></View>
      {SERVERS.map((s) => <PointRow key={s.title} {...s} />)}
    </View>,
    <View key="activities" style={{ gap: 22 }}>
      <View style={{ alignItems: 'center' }}><Vignette kind="friends" width={cardWidth} animate={!reduce} /></View>
      <View style={{ gap: 6 }}><Text variant="title">Do something together</Text><Text variant="callout" color="textSecondary">Activities make it easy to move from a shared interest to a real plan.</Text></View>
      {ACTIVITIES.map((s) => <PointRow key={s.title} {...s} />)}
    </View>,
  ];

  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, paddingTop: insets.top }}>
      <View style={{ alignItems: 'center', paddingTop: 16 }}>
        <Logo width={120} />
      </View>

      <FlatList
        ref={list}
        data={pages}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onEnd}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        style={{ flex: 1 }}
        renderItem={({ item }) => (
          <ScrollView
            style={{ width }}
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: t.spacing.xxl, paddingVertical: t.spacing.xl }}
            showsVerticalScrollIndicator={false}>
            {item}
          </ScrollView>
        )}
      />

      <View
        accessibilityRole="tablist"
        style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 12 }}>
        {pages.map((_, i) => (
          <Pressable
            key={i}
            accessibilityRole="tab"
            accessibilityLabel={`Intro page ${i + 1} of ${pages.length}`}
            accessibilityState={{ selected: i === page }}
            hitSlop={10}
            onPress={() => {
              list.current?.scrollToIndex({ index: i, animated: true });
              setPage(i);
            }}>
            <View
              style={{
                height: 8, width: i === page ? 24 : 8, borderRadius: 4,
                backgroundColor: i === page ? t.colors.primary : t.colors.borderStrong,
              }}
            />
          </Pressable>
        ))}
      </View>

      <View style={{ paddingHorizontal: t.spacing.xl, paddingBottom: Math.max(insets.bottom, 16) + 4, gap: 10 }}>
        <Button title="Get started or sign in" size="lg" fullWidth onPress={() => router.push('/continue')} />
      </View>
    </View>
  );
}
