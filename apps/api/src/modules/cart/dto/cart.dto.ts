import {
  addCartItemSchema,
  cartItemsBodySchema,
  cartQuerySchema,
  cartQuoteBodySchema,
  updateCartItemSchema,
  type AddCartItemInput,
  type CartItemsBody,
  type CartQuery,
  type CartQuoteBody,
  type UpdateCartItemInput,
} from '@ecommerce/types';

export {
  addCartItemSchema,
  cartItemsBodySchema,
  cartQuerySchema,
  cartQuoteBodySchema,
  updateCartItemSchema,
};
export type AddCartItemDto = AddCartItemInput;
export type MergeCartDto = CartItemsBody;
export type CartQueryDto = CartQuery;
export type CartQuoteDto = CartQuoteBody;
export type UpdateCartItemDto = UpdateCartItemInput;
