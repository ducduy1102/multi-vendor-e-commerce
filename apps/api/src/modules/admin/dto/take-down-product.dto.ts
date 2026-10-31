import {
  restoreProductSchema,
  takeDownProductSchema,
  type RestoreProductInput,
  type TakeDownProductInput,
} from '@ecommerce/types';

export { restoreProductSchema, takeDownProductSchema };
export type TakeDownProductDto = TakeDownProductInput;
export type RestoreProductDto = RestoreProductInput;
