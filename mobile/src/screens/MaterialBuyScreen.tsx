import React, { useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Image, Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { submitMaterialPurchase, updatePurchasePhotoUrls, type PurchaseItem } from '../materialBuy/materialBuyApi';
import { pickPhotos, uploadPhoto, remainingPhotoSlots, MAX_PHOTOS } from '../photos/photoUpload';
import { Colors } from '../theme/colors';
import TopBar from '../components/TopBar';
import FadeInView from '../components/FadeInView';
import AnimatedPressable from '../components/AnimatedPressable';
import DismissKeyboardView from '../components/DismissKeyboardView';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'MaterialBuy'>;

interface ItemDraft {
  itemName: string;
  quantity: string;
  unit: string;
  pricePerUnit: string;
  spec1: string;
  spec2: string;
  notes: string;
}

function blankItem(): ItemDraft {
  return { itemName: '', quantity: '', unit: '', pricePerUnit: '', spec1: '', spec2: '', notes: '' };
}

function itemTotal(item: ItemDraft): number {
  const quantity = parseFloat(item.quantity) || 0;
  const pricePerUnit = parseFloat(item.pricePerUnit) || 0;
  return quantity * pricePerUnit;
}

type UploadState = 'idle' | 'uploading' | 'failed';

export default function MaterialBuyScreen({ navigation }: Props) {
  const { user } = useAuth();
  const scrollRef = useRef<ScrollView>(null);

  const [siteId, setSiteId] = useState('');
  const [siteName, setSiteName] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [notes, setNotes] = useState('');
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [pendingDocId, setPendingDocId] = useState<string | null>(null);
  const [pendingUris, setPendingUris] = useState<string[]>([]);
  const [pendingUploadedUrls, setPendingUploadedUrls] = useState<string[]>([]);

  const grandTotal = items.reduce((sum, item) => sum + itemTotal(item), 0);

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
    setSiteId('');
    setSiteName('');
    setItems([]);
    setNotes('');
    setPhotoUris([]);
  }

  // `alreadyUploaded` carries URLs from a prior attempt on this same docId (a retry after a
  // partial failure) so a retry only re-uploads the URIs that didn't succeed yet — never the
  // ones already sitting in Storage.
  async function uploadPendingPhotos(docId: string, uris: string[], alreadyUploaded: string[] = []) {
    if (!user) return;
    setPendingDocId(docId);
    setPendingUris(uris);
    setPendingUploadedUrls(alreadyUploaded);
    setUploadState('uploading');
    const uploaded: string[] = [...alreadyUploaded];
    try {
      for (let i = 0; i < uris.length; i++) {
        const url = await uploadPhoto(uris[i], `requests/${user.uid}/material_purchases/${docId}/${Date.now()}_${i}.jpg`);
        uploaded.push(url);
      }
      await updatePurchasePhotoUrls(user.uid, docId, uploaded);
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
    const parsedItems: PurchaseItem[] = items.map((draft) => {
      const quantity = parseFloat(draft.quantity) || 0;
      const pricePerUnit = parseFloat(draft.pricePerUnit) || 0;
      return {
        itemName: draft.itemName.trim(),
        quantity,
        unit: draft.unit.trim(),
        pricePerUnit,
        totalPrice: quantity * pricePerUnit,
        spec1: draft.spec1.trim(),
        spec2: draft.spec2.trim(),
        notes: draft.notes.trim(),
      };
    });
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
    const docId = submitMaterialPurchase(user, {
      siteId: siteId.trim(),
      siteName: siteName.trim(),
      items: parsedItems,
      notes: notes.trim(),
    });
    const uris = photoUris;
    const priorUploadPending = uploadState !== 'idle';
    resetForm();
    setSubmitting(false);
    Alert.alert('Submitted', 'Purchase recorded.');
    if (uris.length > 0) {
      if (priorUploadPending) {
        // A previous submission's photo upload is still in flight or awaiting retry/dismiss.
        // The shared upload-banner state can only track one submission at a time, so queuing
        // this one's photos would silently corrupt or lose track of the previous ones. The
        // purchase record itself is never blocked — only its photos are skipped.
        Alert.alert(
          'Previous upload pending',
          "Your previous purchase's photos are still uploading — this purchase's photos couldn't be queued. Please wait for the previous upload to finish (or retry/dismiss it) before adding photos to a new entry."
        );
      } else {
        uploadPendingPhotos(docId, uris);
      }
    }
  }

  return (
    <View style={styles.screen}>
      <TopBar title="M&T Buy" onBack={() => navigation.goBack()} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="always"
        automaticallyAdjustKeyboardInsets
      >
        <DismissKeyboardView style={styles.dismissFill}>
          {uploadState === 'uploading' && (
            <FadeInView style={styles.banner}>
              <Text style={styles.bannerText}>
                Uploading {pendingUris.length} photo{pendingUris.length === 1 ? '' : 's'}…
              </Text>
            </FadeInView>
          )}
          {uploadState === 'failed' && (
            <FadeInView style={styles.banner}>
              <Text style={styles.bannerText}>Couldn't upload photos for your last purchase.</Text>
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
            <Text style={styles.label}>Site Name (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Skyline Tower B"
              placeholderTextColor={Colors.textMuted}
              value={siteName}
              onChangeText={setSiteName}
            />
            <Text style={styles.label}>Site ID (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Site-001"
              placeholderTextColor={Colors.textMuted}
              value={siteId}
              onChangeText={setSiteId}
            />
          </FadeInView>

          <FadeInView style={styles.card}>
            <Text style={styles.label}>Items</Text>
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
                    placeholder="Price/unit"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                    value={item.pricePerUnit}
                    onChangeText={(text) => updateItem(index, { pricePerUnit: text })}
                  />
                </View>
                <View style={styles.itemRowFields}>
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
                <TextInput
                  style={styles.input}
                  placeholder="Item notes (optional)"
                  placeholderTextColor={Colors.textMuted}
                  value={item.notes}
                  onChangeText={(text) => updateItem(index, { notes: text })}
                />
                <Text style={styles.itemRowTotal}>Total: {itemTotal(item).toFixed(2)}</Text>
              </View>
            ))}
            <AnimatedPressable style={styles.addItemButton} onPress={addItem}>
              <Text style={styles.buttonText}>+ Add Item</Text>
            </AnimatedPressable>
            {items.length > 0 && <Text style={styles.grandTotal}>Grand Total: {grandTotal.toFixed(2)}</Text>}
          </FadeInView>

          <FadeInView style={styles.card}>
            <Text style={styles.label}>Notes (optional)</Text>
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

            <Text style={styles.label}>Photos (optional, up to {MAX_PHOTOS})</Text>
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

            {formError && <Text style={styles.error}>{formError}</Text>}
            <AnimatedPressable style={styles.button} disabled={submitting} onPress={handleSubmit}>
              <Text style={styles.buttonText}>{submitting ? 'Submitting…' : 'Submit Purchase'}</Text>
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
    backgroundColor: Colors.statusPendingBg,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  bannerText: { fontSize: 14, color: Colors.statusPendingFg, fontWeight: '600' },
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
  label: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600', marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.screenBg,
    borderRadius: 10,
    padding: 12,
    color: Colors.textPrimary,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
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
  itemRowTotal: { fontSize: 13, color: Colors.primary, fontWeight: '700', textAlign: 'right' },
  addItemButton: { backgroundColor: Colors.accent, padding: 12, borderRadius: 10, alignItems: 'center' },
  grandTotal: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, textAlign: 'right' },
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
  error: { color: Colors.statusRejectedFg, fontSize: 13 },
  button: { backgroundColor: Colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  buttonText: { color: 'white', fontWeight: '600' },
});
