import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Image, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { submitTransfer, updateTransferPhotoUrls, type TransferCollection, type TransferItem } from './transferApi';
import { pickPhotos, uploadPhoto, remainingPhotoSlots, MAX_PHOTOS } from '../photos/photoUpload';
import { Colors } from '../theme/colors';
import TopBar from '../components/TopBar';
import FadeInView from '../components/FadeInView';
import AnimatedPressable from '../components/AnimatedPressable';
import DismissKeyboardView from '../components/DismissKeyboardView';
import { usePullToRefresh } from '../components/usePullToRefresh';

interface ItemDraft {
  itemName: string;
  quantity: string;
  unit: string;
  condition: string;
  make: string;
  spec1: string;
  spec2: string;
}

function blankItem(): ItemDraft {
  return { itemName: '', quantity: '', unit: '', condition: '', make: '', spec1: '', spec2: '' };
}

type UploadState = 'idle' | 'uploading' | 'failed';

function todayLabel(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Small icon+label row used for every field group in this form, giving each section a
// visual anchor instead of relying on bold text alone.
function SectionLabel({ icon, children }: { icon: keyof typeof Ionicons.glyphMap; children: React.ReactNode }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Ionicons name={icon} size={15} color={Colors.textSecondary} />
      <Text style={styles.label}>{children}</Text>
    </View>
  );
}

interface Props {
  collection: TransferCollection;
  title: string;
  submitLabel: string;
  onBack: () => void;
}

// Shared by Material Transfer and Tool Transfer — same Firestore shape and UI on Android,
// differing only in which collection they write to and their screen copy.
export default function TransferForm({ collection, title, submitLabel, onBack }: Props) {
  const { user } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const { refreshControl } = usePullToRefresh();

  const [fromLocation, setFromLocation] = useState('');
  const [toLocation, setToLocation] = useState('');
  const [transferredBy, setTransferredBy] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [notes, setNotes] = useState('');
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [pendingDocId, setPendingDocId] = useState<string | null>(null);
  const [pendingUris, setPendingUris] = useState<string[]>([]);
  const [pendingUploadedUrls, setPendingUploadedUrls] = useState<string[]>([]);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    };
  }, []);

  function showSuccess(message: string) {
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    setSuccessMessage(message);
    successTimeoutRef.current = setTimeout(() => setSuccessMessage(null), 2500);
  }

  function addItem() {
    setItems((prev) => [...prev, blankItem()]);
  }

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleAddPhoto() {
    const picked = await pickPhotos(photoUris.length);
    if (picked.length > 0) {
      setPhotoUris((prev) => [...prev, ...picked]);
    }
  }

  function removePhoto(index: number) {
    setPhotoUris((prev) => prev.filter((_, i) => i !== index));
  }

  function resetForm() {
    setFromLocation('');
    setToLocation('');
    setTransferredBy('');
    setReceivedBy('');
    setItems([]);
    setNotes('');
    setPhotoUris([]);
  }

  // Same retry-safe upload pattern as MaterialBuyScreen.uploadPendingPhotos.
  async function uploadPendingPhotos(docId: string, uris: string[], alreadyUploaded: string[] = []) {
    if (!user) return;
    setPendingDocId(docId);
    setPendingUris(uris);
    setPendingUploadedUrls(alreadyUploaded);
    setUploadState('uploading');
    const uploaded: string[] = [...alreadyUploaded];
    try {
      for (let i = 0; i < uris.length; i++) {
        const url = await uploadPhoto(uris[i], `requests/${user.uid}/${collection}/${docId}/${Date.now()}_${i}.jpg`);
        uploaded.push(url);
      }
      await updateTransferPhotoUrls(collection, user.uid, docId, uploaded);
      setUploadState('idle');
      setPendingDocId(null);
      setPendingUris([]);
      setPendingUploadedUrls([]);
    } catch (error) {
      console.error('Photo upload failed', error);
      const succeededThisPass = uploaded.length - alreadyUploaded.length;
      setPendingUris(uris.slice(succeededThisPass));
      setPendingUploadedUrls(uploaded);
      setUploadState('failed');
    }
  }

  function handleRetryUpload() {
    if (!pendingDocId) return;
    uploadPendingPhotos(pendingDocId, pendingUris, pendingUploadedUrls);
  }

  function handleDismissUploadBanner() {
    setUploadState('idle');
    setPendingDocId(null);
    setPendingUris([]);
    setPendingUploadedUrls([]);
  }

  async function handleSubmit() {
    setFormError(null);
    if (!fromLocation.trim()) {
      setFormError('Please enter the from location.');
      return;
    }
    if (!toLocation.trim()) {
      setFormError('Please enter the to location.');
      return;
    }
    if (!transferredBy.trim()) {
      setFormError('Please enter who is transferring.');
      return;
    }
    if (!receivedBy.trim()) {
      setFormError('Please enter who is receiving.');
      return;
    }
    const parsedItems: TransferItem[] = items.map((draft) => ({
      itemName: draft.itemName.trim(),
      quantity: parseFloat(draft.quantity) || 0,
      unit: draft.unit.trim(),
      condition: draft.condition.trim(),
      make: draft.make.trim(),
      spec1: draft.spec1.trim(),
      spec2: draft.spec2.trim(),
    }));
    if (parsedItems.length === 0) {
      setFormError('Please add at least one item.');
      return;
    }
    if (parsedItems.some((item) => !item.itemName || item.quantity <= 0)) {
      setFormError('Please fill in all item names and quantities.');
      return;
    }
    if (!user || submitting) return;
    setSubmitting(true);
    const docId = submitTransfer(collection, user, {
      fromLocation: fromLocation.trim(),
      toLocation: toLocation.trim(),
      transferredBy: transferredBy.trim(),
      receivedBy: receivedBy.trim(),
      items: parsedItems,
      notes: notes.trim(),
    });
    const uris = photoUris;
    const priorUploadPending = uploadState !== 'idle';
    resetForm();
    setSubmitting(false);
    showSuccess('Transfer recorded.');
    if (uris.length > 0) {
      if (priorUploadPending) {
        Alert.alert(
          'Previous upload pending',
          "Your previous transfer's photos are still uploading — this transfer's photos couldn't be queued. Please wait for the previous upload to finish (or retry/dismiss it) before adding photos to a new entry."
        );
      } else {
        uploadPendingPhotos(docId, uris);
      }
    }
  }

  return (
    <View style={styles.screen}>
      <TopBar title={title} onBack={onBack} />
      <ScrollView
        ref={scrollRef}
        refreshControl={refreshControl}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="always"
        automaticallyAdjustKeyboardInsets
      >
        <DismissKeyboardView style={styles.dismissFill}>
          {successMessage && (
            <FadeInView style={[styles.banner, styles.bannerSuccess]}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.statusPresentFg} />
              <Text style={[styles.bannerText, styles.bannerTextSuccess]}>{successMessage}</Text>
            </FadeInView>
          )}
          {uploadState === 'uploading' && (
            <FadeInView style={styles.banner}>
              <Text style={styles.bannerText}>
                Uploading {pendingUris.length} photo{pendingUris.length === 1 ? '' : 's'}…
              </Text>
            </FadeInView>
          )}
          {uploadState === 'failed' && (
            <FadeInView style={styles.banner}>
              <Text style={styles.bannerText}>Couldn't upload photos for your last transfer.</Text>
              <View style={styles.bannerActions}>
                <AnimatedPressable style={styles.bannerButton} onPress={handleRetryUpload}>
                  <Text style={styles.buttonText}>Retry</Text>
                </AnimatedPressable>
                <AnimatedPressable style={styles.bannerButtonSecondary} onPress={handleDismissUploadBanner}>
                  <Text style={styles.buttonText}>Dismiss</Text>
                </AnimatedPressable>
              </View>
            </FadeInView>
          )}

          <FadeInView style={styles.card}>
            <View style={styles.sideBySide}>
              <View style={styles.sideBySideField}>
                <SectionLabel icon="location-outline">From</SectionLabel>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Site warehouse"
                  placeholderTextColor={Colors.textMuted}
                  value={fromLocation}
                  onChangeText={setFromLocation}
                />
              </View>
              <View style={styles.sideBySideField}>
                <SectionLabel icon="flag-outline">To</SectionLabel>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Head office"
                  placeholderTextColor={Colors.textMuted}
                  value={toLocation}
                  onChangeText={setToLocation}
                />
              </View>
            </View>
            <View style={styles.sideBySide}>
              <View style={styles.sideBySideField}>
                <SectionLabel icon="person-outline">Handed over by</SectionLabel>
                <TextInput
                  style={styles.input}
                  placeholder="Name"
                  placeholderTextColor={Colors.textMuted}
                  value={transferredBy}
                  onChangeText={setTransferredBy}
                />
              </View>
              <View style={styles.sideBySideField}>
                <SectionLabel icon="person-outline">Received by</SectionLabel>
                <TextInput
                  style={styles.input}
                  placeholder="Name"
                  placeholderTextColor={Colors.textMuted}
                  value={receivedBy}
                  onChangeText={setReceivedBy}
                />
              </View>
            </View>
            <SectionLabel icon="calendar-outline">Transfer date</SectionLabel>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>{todayLabel()}</Text>
            </View>
          </FadeInView>

          <FadeInView style={styles.card}>
            <View style={styles.itemsHeaderRow}>
              <SectionLabel icon="cube-outline">Items</SectionLabel>
              {items.length > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{items.length}</Text>
                </View>
              )}
            </View>
            {items.length === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="cube-outline" size={22} color={Colors.textMuted} />
                <Text style={styles.emptyStateText}>No items yet</Text>
                <Text style={styles.emptyStateSubtext}>Tap "+ Add Item" below to get started</Text>
              </View>
            )}
            {items.map((item, index) => (
              <View key={index} style={styles.itemRow}>
                <View style={styles.itemRowHeader}>
                  <Text style={styles.itemRowTitle}>Item {index + 1}</Text>
                  <AnimatedPressable onPress={() => removeItem(index)}>
                    <Text style={styles.removeText}>Remove</Text>
                  </AnimatedPressable>
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Item name"
                  placeholderTextColor={Colors.textMuted}
                  value={item.itemName}
                  onChangeText={(text) => updateItem(index, { itemName: text })}
                />
                <View style={styles.itemRowFields}>
                  <TextInput
                    style={[styles.input, styles.itemRowField]}
                    placeholder="Qty"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                    value={item.quantity}
                    onChangeText={(text) => updateItem(index, { quantity: text })}
                  />
                  <TextInput
                    style={[styles.input, styles.itemRowField]}
                    placeholder="Unit"
                    placeholderTextColor={Colors.textMuted}
                    value={item.unit}
                    onChangeText={(text) => updateItem(index, { unit: text })}
                  />
                  <TextInput
                    style={[styles.input, styles.itemRowField]}
                    placeholder="Condition"
                    placeholderTextColor={Colors.textMuted}
                    value={item.condition}
                    onChangeText={(text) => updateItem(index, { condition: text })}
                  />
                </View>
                <View style={styles.itemRowFields}>
                  <TextInput
                    style={[styles.input, styles.itemRowField]}
                    placeholder="Make (optional)"
                    placeholderTextColor={Colors.textMuted}
                    value={item.make}
                    onChangeText={(text) => updateItem(index, { make: text })}
                  />
                  <TextInput
                    style={[styles.input, styles.itemRowField]}
                    placeholder="Spec 1 (optional)"
                    placeholderTextColor={Colors.textMuted}
                    value={item.spec1}
                    onChangeText={(text) => updateItem(index, { spec1: text })}
                  />
                  <TextInput
                    style={[styles.input, styles.itemRowField]}
                    placeholder="Spec 2 (optional)"
                    placeholderTextColor={Colors.textMuted}
                    value={item.spec2}
                    onChangeText={(text) => updateItem(index, { spec2: text })}
                  />
                </View>
              </View>
            ))}
            <AnimatedPressable style={styles.addItemButton} onPress={addItem}>
              <Text style={styles.buttonText}>+ Add Item</Text>
            </AnimatedPressable>
          </FadeInView>

          <FadeInView style={styles.card}>
            <SectionLabel icon="document-text-outline">Notes (optional)</SectionLabel>
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Anything else worth noting"
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={3}
              value={notes}
              onChangeText={setNotes}
              onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
            />

            <SectionLabel icon="camera-outline">Photos (optional, up to {MAX_PHOTOS})</SectionLabel>
            <View style={styles.photoStrip}>
              {photoUris.map((uri, index) => (
                <View key={`${uri}-${index}`} style={styles.photoThumbWrap}>
                  <Image source={{ uri }} style={styles.photoThumb} />
                  <AnimatedPressable style={styles.photoRemoveBadge} onPress={() => removePhoto(index)}>
                    <Text style={styles.photoRemoveText}>×</Text>
                  </AnimatedPressable>
                </View>
              ))}
              {remainingPhotoSlots(photoUris.length) > 0 && (
                <AnimatedPressable style={styles.addPhotoButton} onPress={handleAddPhoto}>
                  <Text style={styles.buttonText}>+ Photo</Text>
                </AnimatedPressable>
              )}
            </View>

            {formError && (
              <FadeInView style={[styles.banner, styles.bannerError]}>
                <Ionicons name="alert-circle" size={18} color={Colors.statusRejectedFg} />
                <Text style={[styles.bannerText, styles.bannerTextError]}>{formError}</Text>
              </FadeInView>
            )}
            <AnimatedPressable style={styles.button} disabled={submitting} onPress={handleSubmit}>
              {submitting ? (
                <View style={styles.buttonRow}>
                  <ActivityIndicator color="white" size="small" />
                  <Text style={styles.buttonText}>Submitting…</Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>{submitLabel}</Text>
              )}
            </AnimatedPressable>
          </FadeInView>
        </DismissKeyboardView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screenBg },
  content: { flexGrow: 1, padding: 24, paddingBottom: 40, gap: 16 },
  dismissFill: { flex: 1, gap: 16 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.statusPendingBg,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  bannerText: { fontSize: 14, color: Colors.statusPendingFg, fontWeight: '600', flexShrink: 1 },
  bannerSuccess: { backgroundColor: Colors.statusPresentBg },
  bannerTextSuccess: { color: Colors.statusPresentFg },
  bannerError: { backgroundColor: Colors.statusRejectedBg },
  bannerTextError: { color: Colors.statusRejectedFg },
  bannerActions: { flexDirection: 'row', gap: 10 },
  bannerButton: { backgroundColor: Colors.primary, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  bannerButtonSecondary: { backgroundColor: Colors.textMuted, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
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
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  label: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.screenBg,
    borderRadius: 10,
    padding: 12,
    color: Colors.textPrimary,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  sideBySide: { flexDirection: 'row', gap: 10 },
  sideBySideField: { flex: 1, gap: 4 },
  readOnlyField: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.screenBg,
    borderRadius: 10,
    padding: 12,
  },
  readOnlyText: { color: Colors.textMuted },
  itemsHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  countBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: { fontSize: 12, fontWeight: '700', color: Colors.primaryDark },
  emptyState: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 4,
  },
  emptyStateText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginTop: 4 },
  emptyStateSubtext: { fontSize: 12, color: Colors.textMuted },
  itemRow: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  itemRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemRowTitle: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  removeText: { fontSize: 13, color: Colors.statusRejectedFg, fontWeight: '600' },
  itemRowFields: { flexDirection: 'row', gap: 8 },
  itemRowField: { flex: 1 },
  addItemButton: { backgroundColor: Colors.accent, padding: 12, borderRadius: 10, alignItems: 'center' },
  photoStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoThumbWrap: { width: 64, height: 64 },
  photoThumb: { width: 64, height: 64, borderRadius: 10 },
  photoRemoveBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.statusRejectedFg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveText: { color: 'white', fontSize: 13, lineHeight: 14 },
  addPhotoButton: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: { backgroundColor: Colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { color: 'white', fontWeight: '600' },
});
