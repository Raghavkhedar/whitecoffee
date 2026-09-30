import React, { useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Image, Alert, Platform } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { submitWorkProgress, updateWorkProgressPhotoUrls } from '../workProgress/workProgressApi';
import { pickPhotos, uploadPhoto, remainingPhotoSlots, MAX_PHOTOS } from '../photos/photoUpload';
import { formatDateString } from '../leave/leaveApi';
import { Colors } from '../theme/colors';
import TopBar from '../components/TopBar';
import FadeInView from '../components/FadeInView';
import AnimatedPressable from '../components/AnimatedPressable';
import DismissKeyboardView from '../components/DismissKeyboardView';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'WorkProgress'>;

// Operations' daily site report — port of Android's WorkProgressScreen (Site Name, Date,
// Site ID optional, description required, photos). Same record-first-then-photos pipeline as
// M&T Buy: the report is saved immediately (works offline) and photos upload after.
export default function WorkProgressScreen({ navigation }: Props) {
  const { user } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const [siteName, setSiteName] = useState('');
  const [siteId, setSiteId] = useState('');
  const [date, setDate] = useState(new Date());
  const [description, setDescription] = useState('');
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'failed'>('idle');
  const [pending, setPending] = useState<{ docId: string; uris: string[]; done: string[] } | null>(null);

  async function uploadPending(docId: string, uris: string[], done: string[] = []) {
    if (!user) return;
    setPending({ docId, uris, done });
    setUploadState('uploading');
    const uploaded = [...done];
    try {
      for (let i = 0; i < uris.length; i++) {
        uploaded.push(await uploadPhoto(uris[i], `requests/${user.uid}/work_progress/${docId}/${Date.now()}_${i}.jpg`));
      }
      await updateWorkProgressPhotoUrls(user.uid, docId, uploaded);
      setUploadState('idle');
      setPending(null);
    } catch (e) {
      console.error('Photo upload failed', e);
      setPending({ docId, uris: uris.slice(uploaded.length - done.length), done: uploaded });
      setUploadState('failed');
    }
  }

  function handleSubmit() {
    setFormError(null);
    if (!siteName.trim()) {
      setFormError('Please enter the site name.');
      return;
    }
    if (!description.trim()) {
      setFormError('Please enter a work description.');
      return;
    }
    if (!user || submitting) return;
    setSubmitting(true);
    const docId = submitWorkProgress(user, {
      siteId: siteId.trim(),
      siteName: siteName.trim(),
      date: formatDateString(date),
      workDescription: description.trim(),
    });
    const uris = photoUris;
    const priorPending = uploadState !== 'idle';
    setSiteName('');
    setSiteId('');
    setDescription('');
    setPhotoUris([]);
    setDate(new Date());
    setSubmitting(false);
    Alert.alert('Submitted', 'Work progress recorded.');
    if (uris.length > 0) {
      if (priorPending) {
        Alert.alert(
          'Previous upload pending',
          "Your previous report's photos are still uploading, so this report's photos couldn't be queued. Wait for it to finish (or retry/dismiss it) first.",
        );
      } else {
        uploadPending(docId, uris);
      }
    }
  }

  return (
    <View style={styles.screen}>
      <TopBar title="Work Progress" onBack={() => navigation.goBack()} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="always"
        automaticallyAdjustKeyboardInsets
      >
        <DismissKeyboardView style={styles.fill}>
          {uploadState === 'uploading' && pending && (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>
                Uploading {pending.uris.length} photo{pending.uris.length === 1 ? '' : 's'}…
              </Text>
            </View>
          )}
          {uploadState === 'failed' && pending && (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>Couldn't upload photos for your last report.</Text>
              <View style={styles.bannerRow}>
                <AnimatedPressable style={styles.bannerButton} onPress={() => uploadPending(pending.docId, pending.uris, pending.done)}>
                  <Text style={styles.buttonText}>Retry</Text>
                </AnimatedPressable>
                <AnimatedPressable
                  style={[styles.bannerButton, styles.secondary]}
                  onPress={() => {
                    setUploadState('idle');
                    setPending(null);
                  }}
                >
                  <Text style={styles.buttonText}>Dismiss</Text>
                </AnimatedPressable>
              </View>
            </View>
          )}

          <FadeInView style={styles.card}>
            <Text style={styles.label}>Site Name</Text>
            <TextInput style={styles.input} placeholder="e.g. Tower B" placeholderTextColor={Colors.textMuted} value={siteName} onChangeText={setSiteName} />

            <Text style={styles.label}>Date</Text>
            <View style={styles.dateRow}>
              <DateTimePicker
                value={date}
                mode="date"
                display={Platform.OS === 'ios' ? 'compact' : 'default'}
                maximumDate={new Date()}
                onChange={(_: DateTimePickerEvent, d?: Date) => d && setDate(d)}
              />
            </View>

            <Text style={styles.label}>Site ID (optional)</Text>
            <TextInput style={styles.input} placeholder="e.g. Site-001" placeholderTextColor={Colors.textMuted} value={siteId} onChangeText={setSiteId} />

            <Text style={styles.label}>Work description</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="What was accomplished today…"
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={4}
              value={description}
              onChangeText={setDescription}
              onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
            />

            <Text style={styles.label}>Photos (optional, up to {MAX_PHOTOS})</Text>
            <View style={styles.photoStrip}>
              {photoUris.map((uri, index) => (
                <View key={`${uri}-${index}`} style={styles.thumbWrap}>
                  <Image source={{ uri }} style={styles.thumb} />
                  <AnimatedPressable style={styles.removeBadge} onPress={() => setPhotoUris((p) => p.filter((_, i) => i !== index))}>
                    <Text style={styles.removeText}>×</Text>
                  </AnimatedPressable>
                </View>
              ))}
              {remainingPhotoSlots(photoUris.length) > 0 && (
                <AnimatedPressable
                  style={styles.addPhoto}
                  onPress={async () => {
                    const picked = await pickPhotos(photoUris.length);
                    if (picked.length) setPhotoUris((p) => [...p, ...picked]);
                  }}
                >
                  <Text style={styles.buttonText}>+ Photo</Text>
                </AnimatedPressable>
              )}
            </View>

            {formError && <Text style={styles.error}>{formError}</Text>}
            <AnimatedPressable style={styles.button} disabled={submitting} onPress={handleSubmit}>
              <Text style={styles.buttonText}>{submitting ? 'Submitting…' : 'Submit report'}</Text>
            </AnimatedPressable>
          </FadeInView>
        </DismissKeyboardView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screenBg },
  content: { padding: 24, gap: 16, flexGrow: 1 },
  fill: { flex: 1, gap: 16 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 10,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  label: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.screenBg,
    borderRadius: 12,
    padding: 14,
    color: Colors.textPrimary,
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  dateRow: { alignItems: 'flex-start' },
  photoStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumbWrap: { width: 72, height: 72 },
  thumb: { width: 72, height: 72, borderRadius: 10 },
  removeBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.statusRejectedFg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: 'white', fontWeight: '800', lineHeight: 18 },
  addPhoto: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: Colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: Colors.statusRejectedFg, fontSize: 13 },
  button: { backgroundColor: Colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 6 },
  buttonText: { color: 'white', fontWeight: '600' },
  banner: { backgroundColor: Colors.statusPendingBg, borderRadius: 12, padding: 14, gap: 10 },
  bannerText: { color: Colors.statusPendingFg, fontWeight: '600' },
  bannerRow: { flexDirection: 'row', gap: 10 },
  bannerButton: { backgroundColor: Colors.primary, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  secondary: { backgroundColor: Colors.textMuted },
});
