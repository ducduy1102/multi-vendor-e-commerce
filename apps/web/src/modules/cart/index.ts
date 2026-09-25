// Barrel export cho module cart — export những gì cần dùng ở app/ và module
// khác. Hook/component sẽ được thêm dần ở các bước sau của Tuần 6.
export { AddToCartButton } from './components/AddToCartButton';
export { CartCountBadge } from './components/CartCountBadge';
export { CartHydrator } from './components/CartHydrator';
export { CartPageContainer } from './components/CartPageContainer';
export { QuantityStepper } from './components/QuantityStepper';
export { cartQueryKeys, EMPTY_CART_VIEW, useCart } from './hooks/useCart';
export { useAddToCart } from './hooks/useAddToCart';
export { useCartCount } from './hooks/useCartCount';
export { useRemoveCartItem } from './hooks/useRemoveCartItem';
export { useUpdateCartItem } from './hooks/useUpdateCartItem';
export * as cartService from './services/cart.service';
export { CART_STORAGE_KEY, hydrateCartStore, useCartStore } from './store/cart.store';
export type {
  AddCartItemInput,
  CartDiscount,
  CartItemInput,
  CartItemRow,
  CartLine,
  CartShopGroup,
  CartView,
} from './types';
