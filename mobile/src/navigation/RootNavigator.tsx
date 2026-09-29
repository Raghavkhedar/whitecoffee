import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import AttendanceScreen from '../screens/AttendanceScreen';
import LeaveScreen from '../screens/LeaveScreen';
import RegularizationScreen from '../screens/RegularizationScreen';
import MaterialBuyScreen from '../screens/MaterialBuyScreen';
import MaterialRequestScreen from '../screens/MaterialRequestScreen';
import MaterialTransferScreen from '../screens/MaterialTransferScreen';
import ToolTransferScreen from '../screens/ToolTransferScreen';

export type RootStackParamList = {
  Home: undefined;
  Attendance: undefined;
  Leave: undefined;
  Regularization: undefined;
  MaterialBuy: undefined;
  MaterialRequest: undefined;
  MaterialTransfer: undefined;
  ToolTransfer: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {user ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Attendance" component={AttendanceScreen} />
          <Stack.Screen name="Leave" component={LeaveScreen} />
          <Stack.Screen name="Regularization" component={RegularizationScreen} />
          <Stack.Screen name="MaterialBuy" component={MaterialBuyScreen} />
          <Stack.Screen name="MaterialRequest" component={MaterialRequestScreen} />
          <Stack.Screen name="MaterialTransfer" component={MaterialTransferScreen} />
          <Stack.Screen name="ToolTransfer" component={ToolTransferScreen} />
        </Stack.Navigator>
      ) : (
        <LoginScreen />
      )}
    </NavigationContainer>
  );
}
