/**
 * Product library types: retailer products shared by kitchen and bathroom
 * estimates (backend app/domains/product_library). Pictures are file ids;
 * show one with fileService.getPreviewUrl(id).
 */

/** How a product looks, for the 2D / 3D drawings. Keys read off listings by Claude; any may be missing. */
export interface ProductLook {
  /** Main surface colour, #rrggbb. */
  color?: string;
  material?: string;
  door_style?: string;
  hardware_style?: string;
  sink_type?: string;
  bowls?: number;
  faucet_style?: string;
  pattern?: string;
  [key: string]: string | number | null | undefined;
}

export interface ProductFields {
  category: string;
  title: string;
  brand?: string | null;
  model_number?: string | null;
  sku?: string | null;
  finish?: string | null;
  description?: string | null;
  retailer?: string | null;
  source_url?: string | null;
  price?: number | string | null;
  price_unit: string;
  box_sf?: number | null;
  width_in?: number | null;
  depth_in?: number | null;
  height_in?: number | null;
  tile_width_in?: number | null;
  tile_length_in?: number | null;
  look: ProductLook;
  specs: Record<string, unknown>;
}

export interface Product extends ProductFields {
  id: string;
  retailer: string;
  image_file_ids: string[];
  swatch_file_id?: string | null;
  is_archived: boolean;
  created_at?: string;
  updated_at?: string | null;
}

export interface ProductCreate extends ProductFields {
  /** Pictures to fetch from the retailer and keep copies of, main one first. */
  image_urls?: string[];
  image_file_ids?: string[];
  swatch_file_id?: string | null;
}

export type ProductUpdate = Partial<ProductFields> & {
  image_urls?: string[];
  /** The whole new list, reordered or trimmed. */
  image_file_ids?: string[];
  swatch_file_id?: string | null;
};

/** What an estimate keeps of a product it uses: a copy taken when it was chosen. */
export type ProductSnapshot = Omit<ProductFields, 'specs' | 'description'> & {
  product_id: string;
  retailer: string;
  image_file_ids: string[];
  swatch_file_id?: string | null;
  taken_at: string;
};

/** What was read off a listing, to check and save; nothing is stored yet. */
export interface ProductDraft {
  fields: Partial<ProductFields>;
  image_urls: string[];
  /** The retailer turned the server away: a screenshot (or the bookmarklet) is the way in. */
  blocked: boolean;
  note?: string | null;
}

export interface ProductMetaOption {
  key: string;
  label: string;
  trade?: 'kitchen' | 'bathroom' | 'both';
}

export interface ProductMeta {
  categories: ProductMetaOption[];
  price_units: ProductMetaOption[];
  retailers: ProductMetaOption[];
  /** The values each ProductLook key can take (material, door_style, …). */
  look_options: Record<string, string[]>;
}
