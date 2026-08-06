/**
 * Scopit - Packing Tool Constants
 * UI labels and configuration
 */

// Content hint labels (for display in UI)
export const CONTENT_HINT_CONFIG: Record<string, { label: string; icon: string; category: string }> = {
  clothing_hanging: { label: 'Hanging Garments', icon: '', category: 'Clothing & Textiles' },
  clothing_folded: { label: 'Folded Clothing', icon: '', category: 'Clothing & Textiles' },
  bedding: { label: 'Bedding & Linens', icon: '', category: 'Clothing & Textiles' },
  books: { label: 'Books & Media', icon: '', category: 'Books & Media' },
  documents: { label: 'Documents & Files', icon: '', category: 'Books & Media' },
  electronics: { label: 'Electronics', icon: '', category: 'Electronics' },
  kitchenware: { label: 'Kitchenware & Dishes', icon: '', category: 'Kitchen' },
  fragile: { label: 'Fragile Items', icon: '', category: 'Fragile & Valuables' },
  artwork: { label: 'Artwork & Frames', icon: '', category: 'Fragile & Valuables' },
  collectibles: { label: 'Collectibles', icon: '', category: 'Fragile & Valuables' },
  valuables: { label: 'Jewelry & Valuables', icon: '', category: 'Fragile & Valuables' },
  wine_collection: { label: 'Wine Collection', icon: '', category: 'Fragile & Valuables' },
  furniture: { label: 'Furniture', icon: '', category: 'Furniture' },
  rugs: { label: 'Rugs & Carpets', icon: '', category: 'Furniture' },
  lamps_lighting: { label: 'Lamps & Lighting', icon: '', category: 'Furniture' },
  appliances_small: { label: 'Small Appliances', icon: '', category: 'Appliances' },
  appliances_large: { label: 'Large Appliances', icon: '', category: 'Appliances' },
  toys: { label: 'Toys & Games', icon: '', category: 'Recreation' },
  sports: { label: 'Sports Equipment', icon: '', category: 'Recreation' },
  bicycles: { label: 'Bicycles & Scooters', icon: '', category: 'Recreation' },
  tools: { label: 'Tools & Hardware', icon: '', category: 'Tools & Equipment' },
  equipment_heavy: { label: 'Heavy Equipment', icon: '', category: 'Tools & Equipment' },
  boxes_stored: { label: 'Stored Boxes', icon: '', category: 'Storage' },
  holiday_decor: { label: 'Holiday & Seasonal', icon: '', category: 'Storage' },
  instruments: { label: 'Musical Instruments', icon: '', category: 'Specialty' },
  baby_items: { label: 'Baby & Nursery', icon: '', category: 'Specialty' },
  outdoor_furniture: { label: 'Outdoor Furniture', icon: '', category: 'Outdoor' },
  plants: { label: 'Plants & Pots', icon: '', category: 'Outdoor' },
  chemicals: { label: 'Cleaning & Chemicals', icon: '', category: 'Outdoor' },
};

// Group hints by category for display
export const HINT_CATEGORIES = Object.entries(CONTENT_HINT_CONFIG).reduce((acc, [key, config]) => {
  if (!acc[config.category]) acc[config.category] = [];
  acc[config.category].push({ key, ...config });
  return acc;
}, {} as Record<string, Array<{ key: string; label: string; icon: string; category: string }>>);

// Density options for select
export const DENSITY_OPTIONS = [
  { value: 'light', label: 'Light (0.7x)', description: 'Minimal contents' },
  { value: 'normal', label: 'Normal (1.0x)', description: 'Average contents' },
  { value: 'dense', label: 'Dense (1.3x)', description: 'Above average' },
  { value: 'heavy', label: 'Heavy (1.6x)', description: 'Very full room' },
  { value: 'extreme', label: 'Extreme (2.5x)', description: 'Hoarding level' },
];

// Floor options for select
export const FLOOR_OPTIONS = [
  { value: 'basement', label: 'Basement' },
  { value: '1st', label: '1st Floor' },
  { value: '2nd', label: '2nd Floor' },
  { value: '3rd', label: '3rd Floor' },
  { value: '4th+', label: '4th+ Floor' },
];

// Contamination options
export const CONTAMINATION_OPTIONS = [
  { value: 'clean', label: 'Clean (1.0x)', description: 'No contamination' },
  { value: 'gray_water', label: 'Gray Water (1.4x)', description: 'Category 2 water' },
  { value: 'black_water', label: 'Black Water (1.8x)', description: 'Category 3 / sewage / fire' },
];

// Region options
export const REGION_OPTIONS = [
  { value: 'mid_atlantic', label: 'Mid-Atlantic (DC/VA)', description: 'Baseline' },
  { value: 'northeast', label: 'Northeast (NY/NJ/MA)', description: '+15%' },
  { value: 'west', label: 'West (CA/WA/OR)', description: '+5%' },
  { value: 'midwest', label: 'Midwest (IL/OH/MI)', description: '-10%' },
  { value: 'southwest', label: 'Southwest (TX/AZ)', description: '-15%' },
  { value: 'southeast', label: 'Southeast (FL/GA)', description: '-20%' },
];

// Special items
export const SPECIAL_ITEMS = [
  { key: 'piano', label: 'Piano', price: 450.00 },
  { key: 'pool_table', label: 'Pool Table', price: 385.00 },
  { key: 'gun_safe', label: 'Gun Safe', price: 275.00 },
];

// Default packing settings
export const DEFAULT_SETTINGS = {
  crew_size: 4,
  storage_months: 1,
  staging_type: 'off_site' as const,
  include_packback: true,
  include_op: true,
  op_rate: 20,
  material_rate: 25,
  region: 'mid_atlantic' as const,
  special_items: [] as string[],
  custom_special_items: [] as Array<{ name: string; price: number }>,
};

// Preset category labels (no emojis)
export const PRESET_CATEGORY_ICONS: Record<string, string> = {
  Bedroom: '',
  Kitchen: '',
  Living: '',
  Office: '',
  Storage: '',
  Small: '',
  Specialty: '',
  Outdoor: '',
};

// Unit-based hints: these use quantity chips (1, 2, 3, 4, 5+) instead of volume levels
export const UNIT_HINTS = new Set([
  'sofa', 'loveseat', 'armchair', 'bed_large', 'bed_small',
  'dresser', 'wardrobe', 'dining_table', 'dining_chair',
  'coffee_table', 'bookcase', 'desk',
  'appliances_large', 'appliances_small',
  'clothing_hanging', 'clothing_folded',
  'bicycles', 'instruments',
]);

// Quantity chip options for unit-based hints
export const QTY_CHIPS = [
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '4', value: 4 },
  { label: '5+', value: 6 },
];

// Volume levels for factor-based hints: S/M/L/XL
// Index 1 (M) is the default. mult mirrors backend HINT_VOLUME_MULTS = [0.4, 1.0, 1.8, 3.0]
export interface VolumeLevelOption {
  key: string;
  label: string;
  hint: string;
  mult: number;
}

export const HINT_VOLUME_LEVELS: Record<string, VolumeLevelOption[]> = {
  bedding:          [{ key:'S', label:'1-2 sets',         hint:'~2 boxes',  mult:0.4 }, { key:'M', label:'3-5 sets',           hint:'~4 boxes',  mult:1.0 }, { key:'L', label:'6-10 sets',         hint:'~7 boxes',  mult:1.8 }, { key:'XL', label:'Full household',   hint:'~12 boxes', mult:3.0 }],
  books:            [{ key:'S', label:'1-2 shelves',      hint:'~5 boxes',  mult:0.4 }, { key:'M', label:'3-5 shelves',        hint:'~12 boxes', mult:1.0 }, { key:'L', label:'Full bookcase',      hint:'~20 boxes', mult:1.8 }, { key:'XL', label:'Library-level',    hint:'~35 boxes', mult:3.0 }],
  documents:        [{ key:'S', label:'One drawer',       hint:'~2 boxes',  mult:0.4 }, { key:'M', label:'2-3 cabinets',       hint:'~5 boxes',  mult:1.0 }, { key:'L', label:'Full office files',  hint:'~10 boxes', mult:1.8 }, { key:'XL', label:'Archive-level',    hint:'~18 boxes', mult:3.0 }],
  electronics:      [{ key:'S', label:'Few devices',      hint:'~2 boxes',  mult:0.4 }, { key:'M', label:'Moderate setup',     hint:'~5 boxes',  mult:1.0 }, { key:'L', label:'Heavy AV setup',     hint:'~9 boxes',  mult:1.8 }, { key:'XL', label:'Full AV/studio',   hint:'~15 boxes', mult:3.0 }],
  kitchenware:      [{ key:'S', label:'Basics only',      hint:'~4 boxes',  mult:0.4 }, { key:'M', label:'Standard kitchen',   hint:'~10 boxes', mult:1.0 }, { key:'L', label:'Well-stocked',       hint:'~18 boxes', mult:1.8 }, { key:'XL', label:"Chef's kitchen",   hint:'~30 boxes', mult:3.0 }],
  fragile:          [{ key:'S', label:'A few pieces',     hint:'~2 boxes',  mult:0.4 }, { key:'M', label:'Moderate',           hint:'~5 boxes',  mult:1.0 }, { key:'L', label:'Many items',         hint:'~10 boxes', mult:1.8 }, { key:'XL', label:'Extensive',        hint:'~18 boxes', mult:3.0 }],
  artwork:          [{ key:'S', label:'1-3 pieces',       hint:'~1 crate',  mult:0.4 }, { key:'M', label:'4-10 pieces',        hint:'~3 crates', mult:1.0 }, { key:'L', label:'11-25 pieces',       hint:'~7 crates', mult:1.8 }, { key:'XL', label:'Gallery-level',    hint:'~15 crates',mult:3.0 }],
  collectibles:     [{ key:'S', label:'Small display',    hint:'~3 boxes',  mult:0.4 }, { key:'M', label:'One cabinet',        hint:'~8 boxes',  mult:1.0 }, { key:'L', label:'Multi-cabinet',      hint:'~15 boxes', mult:1.8 }, { key:'XL', label:'Full collection',  hint:'~25 boxes', mult:3.0 }],
  valuables:        [{ key:'S', label:'A few items',      hint:'~1 box',    mult:0.4 }, { key:'M', label:'Moderate',           hint:'~2 boxes',  mult:1.0 }, { key:'L', label:'Large collection',   hint:'~4 boxes',  mult:1.8 }, { key:'XL', label:'Extensive',        hint:'~8 boxes',  mult:3.0 }],
  wine_collection:  [{ key:'S', label:'1-2 cases',        hint:'~2 boxes',  mult:0.4 }, { key:'M', label:'3-8 cases',          hint:'~6 boxes',  mult:1.0 }, { key:'L', label:'9-20 cases',         hint:'~15 boxes', mult:1.8 }, { key:'XL', label:'Full cellar',      hint:'~30 boxes', mult:3.0 }],
  furniture:        [{ key:'S', label:'Few pieces',       hint:'~2 pads',   mult:0.4 }, { key:'M', label:'Moderate',           hint:'~5 pads',   mult:1.0 }, { key:'L', label:'Many pieces',        hint:'~9 pads',   mult:1.8 }, { key:'XL', label:'Full room+',       hint:'~15 pads',  mult:3.0 }],
  rugs:             [{ key:'S', label:'1-2 small',        hint:'~1 roll',   mult:0.4 }, { key:'M', label:'2-4 area rugs',      hint:'~3 rolls',  mult:1.0 }, { key:'L', label:'5-8 rugs',           hint:'~6 rolls',  mult:1.8 }, { key:'XL', label:'Whole-house',      hint:'~10 rolls', mult:3.0 }],
  lamps_lighting:   [{ key:'S', label:'1-2 lamps',        hint:'~2 boxes',  mult:0.4 }, { key:'M', label:'3-5 lamps',          hint:'~5 boxes',  mult:1.0 }, { key:'L', label:'6-10 lamps',         hint:'~9 boxes',  mult:1.8 }, { key:'XL', label:'10+ lamps',        hint:'~15 boxes', mult:3.0 }],
  toys:             [{ key:'S', label:'Small bin',        hint:'~3 boxes',  mult:0.4 }, { key:'M', label:'One room',           hint:'~8 boxes',  mult:1.0 }, { key:'L', label:'Large play area',    hint:'~15 boxes', mult:1.8 }, { key:'XL', label:'Full playroom',    hint:'~25 boxes', mult:3.0 }],
  sports:           [{ key:'S', label:'Few items',        hint:'~2 boxes',  mult:0.4 }, { key:'M', label:'Moderate gear',      hint:'~5 boxes',  mult:1.0 }, { key:'L', label:'Full gear set',      hint:'~10 boxes', mult:1.8 }, { key:'XL', label:'Pro-level',        hint:'~18 boxes', mult:3.0 }],
  tools:            [{ key:'S', label:'Basic toolbox',    hint:'~3 boxes',  mult:0.4 }, { key:'M', label:'Workshop set',       hint:'~8 boxes',  mult:1.0 }, { key:'L', label:'Full workshop',      hint:'~15 boxes', mult:1.8 }, { key:'XL', label:'Pro workshop',     hint:'~25 boxes', mult:3.0 }],
  equipment_heavy:  [{ key:'S', label:'1-2 items',        hint:'~2 pads',   mult:0.4 }, { key:'M', label:'3-5 items',          hint:'~5 pads',   mult:1.0 }, { key:'L', label:'6-10 items',         hint:'~9 pads',   mult:1.8 }, { key:'XL', label:'10+ items',        hint:'~15 pads',  mult:3.0 }],
  boxes_stored:     [{ key:'S', label:'5-10 boxes',       hint:'~8 boxes',  mult:0.4 }, { key:'M', label:'11-25 boxes',        hint:'~20 boxes', mult:1.0 }, { key:'L', label:'26-50 boxes',        hint:'~40 boxes', mult:1.8 }, { key:'XL', label:'50+ boxes',        hint:'~70 boxes', mult:3.0 }],
  holiday_decor:    [{ key:'S', label:'2-3 bins',         hint:'~3 boxes',  mult:0.4 }, { key:'M', label:'4-8 bins',           hint:'~7 boxes',  mult:1.0 }, { key:'L', label:'9-15 bins',          hint:'~12 boxes', mult:1.8 }, { key:'XL', label:'Whole room',       hint:'~20 boxes', mult:3.0 }],
  baby_items:       [{ key:'S', label:'Small items',      hint:'~3 boxes',  mult:0.4 }, { key:'M', label:'Standard nursery',   hint:'~8 boxes',  mult:1.0 }, { key:'L', label:'Full nursery',       hint:'~14 boxes', mult:1.8 }, { key:'XL', label:'Twins/multiples',  hint:'~22 boxes', mult:3.0 }],
  outdoor_furniture:[{ key:'S', label:'1-2 pieces',       hint:'~2 pads',   mult:0.4 }, { key:'M', label:'Patio set',          hint:'~5 pads',   mult:1.0 }, { key:'L', label:'Full patio',         hint:'~9 pads',   mult:1.8 }, { key:'XL', label:'Large outdoor',    hint:'~15 pads',  mult:3.0 }],
  plants:           [{ key:'S', label:'1-5 pots',         hint:'~2 boxes',  mult:0.4 }, { key:'M', label:'6-15 pots',          hint:'~5 boxes',  mult:1.0 }, { key:'L', label:'16-30 pots',         hint:'~10 boxes', mult:1.8 }, { key:'XL', label:'30+ pots',         hint:'~18 boxes', mult:3.0 }],
  chemicals:        [{ key:'S', label:'Few products',     hint:'~1 box',    mult:0.4 }, { key:'M', label:'Standard supply',    hint:'~2 boxes',  mult:1.0 }, { key:'L', label:'Large supply',       hint:'~4 boxes',  mult:1.8 }, { key:'XL', label:'Storage room',     hint:'~8 boxes',  mult:3.0 }],
};

// Allowed content hint keys per room preset category.
// Only these hints will be shown in the Content Hints section for that room type.
export const PRESET_CATEGORY_HINTS: Record<string, string[]> = {
  Bedroom: [
    'clothing_hanging', 'clothing_folded', 'bedding',
    'books',
    'electronics',
    'fragile', 'artwork', 'collectibles', 'valuables',
    'furniture', 'rugs', 'lamps_lighting',
    'baby_items', 'instruments',
  ],
  Kitchen: [
    'kitchenware',
    'fragile', 'collectibles',
    'appliances_small', 'appliances_large',
  ],
  Living: [
    'electronics',
    'fragile', 'artwork', 'collectibles', 'valuables', 'wine_collection',
    'furniture', 'rugs', 'lamps_lighting',
    'books', 'instruments',
  ],
  Office: [
    'books', 'documents',
    'electronics',
    'artwork', 'collectibles', 'fragile',
    'furniture',
  ],
  Storage: [
    'boxes_stored', 'holiday_decor',
    'tools', 'equipment_heavy',
    'sports', 'bicycles',
    'appliances_small', 'appliances_large',
    'electronics', 'furniture',
    'fragile', 'artwork', 'collectibles',
    'chemicals',
  ],
  Small: [
    'clothing_hanging', 'clothing_folded', 'bedding',
    'appliances_large',
    'fragile',
    'furniture', 'artwork',
    'chemicals',
  ],
  Specialty: [
    'instruments',
    'equipment_heavy',
    'electronics',
    'sports',
    'furniture',
  ],
  Outdoor: [
    'outdoor_furniture', 'plants', 'chemicals',
    'tools', 'equipment_heavy',
    'sports', 'bicycles',
    'boxes_stored',
  ],
};

// Wizard steps
export const WIZARD_STEPS = [
  { title: 'Details', description: 'Client & settings' },
  { title: 'Rooms', description: 'Select rooms' },
  { title: 'Review', description: 'Review & export' },
];
