import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import TransferForm from '../transfer/TransferForm';

type Props = NativeStackScreenProps<RootStackParamList, 'ToolTransfer'>;

export default function ToolTransferScreen({ navigation }: Props) {
  return (
    <TransferForm
      collection="tool_transfers"
      title="Tool Transfer"
      submitLabel="Record Transfer"
      onBack={() => navigation.goBack()}
    />
  );
}
