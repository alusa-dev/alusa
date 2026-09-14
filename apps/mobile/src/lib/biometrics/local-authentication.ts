import * as LocalAuthentication from 'expo-local-authentication';

export async function getBiometricAvailability() {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);

  return {
    available: hasHardware && isEnrolled,
    hasHardware,
    isEnrolled,
  };
}

export async function authenticateWithBiometrics() {
  const availability = await getBiometricAvailability();
  if (!availability.available) return false;

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Use a biometria para proteger seu acesso à Alusa',
    cancelLabel: 'Usar senha',
    disableDeviceFallback: false,
  });

  return result.success;
}
