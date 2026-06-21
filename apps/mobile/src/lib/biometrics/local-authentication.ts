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
