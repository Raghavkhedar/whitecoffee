import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import TransferForm from '../transfer/TransferForm';

type Props = NativeStackScreenProps<RootStackParamList, 'MaterialTransfer'>;

export default function MaterialTransferScreen({ navigation }: Props) {
  return (
    <TransferForm
      collection="material_transfers"
      title="Material Transfer"
      submitLabel="Record Transfer"
      onBack={() => navigation.goBack()}
    />
  );
}
