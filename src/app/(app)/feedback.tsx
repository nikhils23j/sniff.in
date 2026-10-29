import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppHeader, Banner, Button, Card, Screen, Tag, Text, TextField, toast } from '@/components/ui';
import { useUserId } from '@/features/auth/session-store';
import { supabase } from '@/lib/supabase';
import { finalizeMediaUpload, prepareImage, randomFileName, uploadWithProgress } from '@/lib/upload';

type Category = 'bug' | 'suggestion' | 'other';
type Attachment = { uri: string; name: string; path?: string };
const categories: { key: Category; label: string }[] = [
  { key: 'bug', label: 'Something broke' }, { key: 'suggestion', label: 'An idea' }, { key: 'other', label: 'Something else' },
];

export default function FeedbackScreen() {
  const uid = useUserId();
  const [category, setCategory] = useState<Category>('suggestion');
  const [body, setBody] = useState('');
  const [images, setImages] = useState<Attachment[]>([]);
  const [clientId, setClientId] = useState(() => Crypto.randomUUID());
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = () => { setClientId(Crypto.randomUUID()); setError(null); };
  const chooseImages = async () => {
    try {
      const remaining = 5 - images.length;
      if (!remaining) return toast.info('You can attach up to five photos.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true,
        selectionLimit: remaining, quality: 1 });
      if (result.canceled || !result.assets.length) return;
      const chosen = result.assets.slice(0, remaining).map((asset, i) => ({ uri: asset.uri, name: asset.fileName ?? `Photo ${images.length + i + 1}` }));
      setImages((current) => [...current, ...chosen]);
      changed();
    } catch (cause) { toast.error(cause); }
  };
  const removeImage = (uri: string) => { setImages((current) => current.filter((image) => image.uri !== uri)); changed(); };
  const submit = async () => {
    if (!uid || body.trim().length < 10) { setError('Describe the change or issue in at least 10 characters.'); return; }
    setBusy(true); setError(null);
    try {
      const paths: string[] = [];
      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        let path = image.path;
        if (!path) {
          setProgress(`Optimizing photo ${i + 1} of ${images.length}…`);
          const prepared = await prepareImage(image.uri, 1280);
          path = `${uid}/${randomFileName('jpg')}`;
          await uploadWithProgress({ bucket: 'feedback-media', path, uri: prepared.uri, contentType: prepared.mime,
            onProgress: (fraction) => setProgress(`Uploading photo ${i + 1} of ${images.length} · ${Math.round(fraction * 100)}%`) });
          const savedPath = path;
          setImages((current) => current.map((item) => item.uri === image.uri ? { ...item, path: savedPath } : item));
        }
        paths.push(path);
      }
      setProgress('Sending feedback…');
      const { data, error: sendError } = await supabase.functions.invoke<{ sent?: boolean; error?: string }>('send-feedback', {
        body: { client_id: clientId, category, body: body.trim(), paths },
      });
      if (sendError || !data?.sent) throw new Error(data?.error === 'email_send_failed'
        ? 'Email delivery failed. Your feedback is saved; please retry.' : 'Feedback could not be sent. Please try again.');
      await Promise.allSettled(paths.map((path) => finalizeMediaUpload('feedback-media', path)));
      setDone(true);
    } catch (cause) { setError((cause as Error)?.message ?? 'Feedback could not be sent. Please try again.'); }
    finally { setBusy(false); setProgress(null); }
  };

  if (done) return <Screen header={<AppHeader title="Feedback" />} footer={<Button title="Done" onPress={() => router.back()} />}>
    <Card tone="brand" style={{ gap: 12, marginTop: 24 }}>
      <Text variant="heading">Thank you for helping improve Sniff.in</Text>
      <Text variant="body" color="textSecondary">Your feedback and photos were emailed to the app owner.</Text>
    </Card>
  </Screen>;

  return <Screen header={<AppHeader title="Send feedback" />}
    footer={<Button title="Submit feedback" size="lg" fullWidth loading={busy} disabled={body.trim().length < 10 || busy} onPress={() => void submit()} />}>
    <Text variant="callout" color="textSecondary">Share a change, an idea or something that did not work.</Text>
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      {categories.map((c) => <Tag key={c.key} label={c.label} selected={category === c.key} onPress={() => { setCategory(c.key); changed(); }} />)}
    </View>
    <TextField label="Suggested change or idea" value={body} onChangeText={(value) => { setBody(value); changed(); }} multiline maxCount={2000}
      placeholder="What would you like us to improve?" />
    {error ? <Banner tone="danger" body={error} /> : null}
    {progress ? <Text variant="caption" color="textSecondary">{progress}</Text> : null}
    <Text variant="subheading">Photos (optional) · {images.length}/5</Text>
    {images.map((image) => <Card key={image.uri} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text variant="callout" style={{ flex: 1 }} numberOfLines={1}>{image.name}</Text>
      <Button title="Remove" size="sm" variant="ghost" disabled={busy} onPress={() => removeImage(image.uri)} />
    </Card>)}
    {images.length < 5 ? <Button title="Add photos" icon="images-outline" variant="secondary" disabled={busy} onPress={() => void chooseImages()} /> : null}
  </Screen>;
}
