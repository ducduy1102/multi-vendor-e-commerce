import {
  idempotencyKeySchema,
  placeOrderSchema,
  previewCheckoutSchema,
  type PlaceOrderInput,
  type PreviewCheckoutInput,
} from '@ecommerce/types';

export { idempotencyKeySchema, placeOrderSchema, previewCheckoutSchema };
export type PlaceOrderDto = PlaceOrderInput;
export type PreviewCheckoutDto = PreviewCheckoutInput;
