// Barrel export cho module checkout — export những gì app/ cần. Không export
// sâu file nội bộ (shared/lib/module-boundaries.test.ts kiểm điều này).
export { addressesQueryKey, useAddresses } from './hooks/useAddresses';
export { useCreateAddress } from './hooks/useCreateAddress';
export { useUpdateAddress } from './hooks/useUpdateAddress';
export { useDeleteAddress } from './hooks/useDeleteAddress';
export { useSetDefaultAddress } from './hooks/useSetDefaultAddress';
export { usePlaceOrder } from './hooks/usePlaceOrder';
export { checkoutGroupQueryKey, useCheckoutGroup } from './hooks/useCheckoutGroup';
export { useRetryPayment } from './hooks/useRetryPayment';
export * as checkoutService from './services/checkout.service';
export { AddressForm } from './components/AddressForm';
export { AddressFormContainer } from './components/AddressFormContainer';
export { AddressRadioList } from './components/AddressRadioList';
export type { AddressFormInput } from './schemas/address.schema';
export type {
  Address,
  CheckoutGroup,
  CheckoutGroupStatus,
  CheckoutOrder,
  CheckoutOrderItem,
  CheckoutResult,
  CreateAddressInput,
  PayAttemptResult,
  PaymentMethod,
  PaymentStatus,
  PlaceOrderInput,
  UpdateAddressInput,
} from './types';
