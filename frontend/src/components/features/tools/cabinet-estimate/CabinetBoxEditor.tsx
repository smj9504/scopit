import React from 'react';
import {
  Button,
  Checkbox,
  Col,
  InputNumber,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { CabinetBoxCreate, CabinetLocation, CabinetTier, CabType, DoorPattern, SpecialtyType } from '@/types/cabinetEstimate';
import {
  DOOR_PATTERN_OPTIONS,
  NO_DOOR_SPECIALTIES,
  PLAIN_DOOR,
  TALL_DOOR_PATTERN_OPTIONS,
  specialtyName,
} from '@/components/features/tools/cabinet-estimate/cabinetBoxChoices';

const { Text } = Typography;

// Common cabinet codes with default dimensions
export const CABINET_PRESETS: Record<string, { cab_type: CabType; width: number; height: number; specialty?: SpecialtyType; label: string }> = {
  // Base
  'B9':  { cab_type: 'base', width: 9,  height: 34.5, label: 'Base 9"' },
  'B12': { cab_type: 'base', width: 12, height: 34.5, label: 'Base 12"' },
  'B15': { cab_type: 'base', width: 15, height: 34.5, label: 'Base 15"' },
  'B18': { cab_type: 'base', width: 18, height: 34.5, label: 'Base 18"' },
  'B21': { cab_type: 'base', width: 21, height: 34.5, label: 'Base 21"' },
  'B24': { cab_type: 'base', width: 24, height: 34.5, label: 'Base 24"' },
  'B27': { cab_type: 'base', width: 27, height: 34.5, label: 'Base 27"' },
  'B30': { cab_type: 'base', width: 30, height: 34.5, label: 'Base 30"' },
  'B33': { cab_type: 'base', width: 33, height: 34.5, label: 'Base 33"' },
  'B36': { cab_type: 'base', width: 36, height: 34.5, label: 'Base 36"' },
  'B39': { cab_type: 'base', width: 39, height: 34.5, label: 'Base 39"' },
  'B42': { cab_type: 'base', width: 42, height: 34.5, label: 'Base 42"' },
  'B45': { cab_type: 'base', width: 45, height: 34.5, label: 'Base 45"' },
  'B48': { cab_type: 'base', width: 48, height: 34.5, label: 'Base 48"' },
  // Base - Sink Base
  'SB30': { cab_type: 'base', width: 30, height: 34.5, specialty: 'sink_base', label: 'Sink Base 30"' },
  'SB33': { cab_type: 'base', width: 33, height: 34.5, specialty: 'sink_base', label: 'Sink Base 33"' },
  'SB36': { cab_type: 'base', width: 36, height: 34.5, specialty: 'sink_base', label: 'Sink Base 36"' },
  'SB42': { cab_type: 'base', width: 42, height: 34.5, specialty: 'sink_base', label: 'Sink Base 42"' },
  // Base - Blind Corner
  'BBC36': { cab_type: 'base', width: 36, height: 34.5, specialty: 'blind_corner', label: 'Blind Corner Base 36"' },
  'BBC39': { cab_type: 'base', width: 39, height: 34.5, specialty: 'blind_corner', label: 'Blind Corner Base 39"' },
  'BBC42': { cab_type: 'base', width: 42, height: 34.5, specialty: 'blind_corner', label: 'Blind Corner Base 42"' },
  'BBC45': { cab_type: 'base', width: 45, height: 34.5, specialty: 'blind_corner', label: 'Blind Corner Base 45"' },
  // Base - Drawer Base
  'DB12': { cab_type: 'base', width: 12, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 12"' },
  'DB15': { cab_type: 'base', width: 15, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 15"' },
  'DB18': { cab_type: 'base', width: 18, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 18"' },
  'DB21': { cab_type: 'base', width: 21, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 21"' },
  'DB24': { cab_type: 'base', width: 24, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 24"' },
  'DB27': { cab_type: 'base', width: 27, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 27"' },
  'DB30': { cab_type: 'base', width: 30, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 30"' },
  'DB36': { cab_type: 'base', width: 36, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 36"' },
  // Base - Lazy Susan
  'LS33': { cab_type: 'base', width: 33, height: 34.5, specialty: 'lazy_susan', label: 'Lazy Susan Corner 33"' },
  'LS36': { cab_type: 'base', width: 36, height: 34.5, specialty: 'lazy_susan', label: 'Lazy Susan Corner 36"' },
  // Base - Diagonal corner (angled front, 36" along each wall)
  'DCB36': { cab_type: 'base', width: 36, height: 34.5, specialty: 'diagonal_corner_base', label: 'Diagonal Corner Base 36"' },
  // Base - Angle end: a run end cut back at 45° (KCD BEC24, two doors)
  'BEC24': { cab_type: 'base', width: 24, height: 34.5, specialty: 'angle_end_base', label: 'Angle End Base 24"' },
  // Base - Trash / recycle pull-out (standard in a new kitchen)
  'TP15': { cab_type: 'base', width: 15, height: 34.5, specialty: 'trash_pullout', label: 'Trash Pull-out 15"' },
  'TP18': { cab_type: 'base', width: 18, height: 34.5, specialty: 'trash_pullout', label: 'Trash Pull-out 18"' },
  'TP21': { cab_type: 'base', width: 21, height: 34.5, specialty: 'trash_pullout', label: 'Trash Pull-out 21"' },
  'TP24': { cab_type: 'base', width: 24, height: 34.5, specialty: 'trash_pullout', label: 'Trash Pull-out 24"' },
  // Base - Farmhouse / apron sink base (front cut away for the apron)
  'FSB30': { cab_type: 'base', width: 30, height: 34.5, specialty: 'farmhouse_sink_base', label: 'Farmhouse Sink Base 30"' },
  'FSB33': { cab_type: 'base', width: 33, height: 34.5, specialty: 'farmhouse_sink_base', label: 'Farmhouse Sink Base 33"' },
  'FSB36': { cab_type: 'base', width: 36, height: 34.5, specialty: 'farmhouse_sink_base', label: 'Farmhouse Sink Base 36"' },
  // Base - Microwave drawer base
  'MWD24': { cab_type: 'base', width: 24, height: 34.5, specialty: 'microwave_drawer_base', label: 'Microwave Drawer 24"' },
  'MWD27': { cab_type: 'base', width: 27, height: 34.5, specialty: 'microwave_drawer_base', label: 'Microwave Drawer 27"' },
  'MWD30': { cab_type: 'base', width: 30, height: 34.5, specialty: 'microwave_drawer_base', label: 'Microwave Drawer 30"' },
  // Base - Range Base (opening for the range; panels/build priced separately)
  'RB30S': { cab_type: 'base', width: 30, height: 34.5, specialty: 'range_base_slide_in', label: 'Range Base 30" (Slide-in)' },
  'RB36S': { cab_type: 'base', width: 36, height: 34.5, specialty: 'range_base_slide_in', label: 'Range Base 36" (Slide-in)' },
  'RB40S': { cab_type: 'base', width: 40, height: 34.5, specialty: 'range_base_slide_in', label: 'Range Base 40" (Slide-in)' },
  'RB30D': { cab_type: 'base', width: 30, height: 34.5, specialty: 'range_base_drop_in', label: 'Range Base 30" (Drop-in)' },
  'RB36D': { cab_type: 'base', width: 36, height: 34.5, specialty: 'range_base_drop_in', label: 'Range Base 36" (Drop-in)' },
  'RB40D': { cab_type: 'base', width: 40, height: 34.5, specialty: 'range_base_drop_in', label: 'Range Base 40" (Drop-in)' },
  // Wall - Standard (30"H)
  'W0930': { cab_type: 'wall', width: 9,  height: 30, label: '9"W x 30"H' },
  'W1230': { cab_type: 'wall', width: 12, height: 30, label: '12"W x 30"H' },
  'W1530': { cab_type: 'wall', width: 15, height: 30, label: '15"W x 30"H' },
  'W1830': { cab_type: 'wall', width: 18, height: 30, label: '18"W x 30"H' },
  'W2130': { cab_type: 'wall', width: 21, height: 30, label: '21"W x 30"H' },
  'W2430': { cab_type: 'wall', width: 24, height: 30, label: '24"W x 30"H' },
  'W2730': { cab_type: 'wall', width: 27, height: 30, label: '27"W x 30"H' },
  'W3030': { cab_type: 'wall', width: 30, height: 30, label: '30"W x 30"H' },
  'W3330': { cab_type: 'wall', width: 33, height: 30, label: '33"W x 30"H' },
  'W3630': { cab_type: 'wall', width: 36, height: 30, label: '36"W x 30"H' },
  'W3930': { cab_type: 'wall', width: 39, height: 30, label: '39"W x 30"H' },
  'W4230': { cab_type: 'wall', width: 42, height: 30, label: '42"W x 30"H' },
  'W4530': { cab_type: 'wall', width: 45, height: 30, label: '45"W x 30"H' },
  'W4830': { cab_type: 'wall', width: 48, height: 30, label: '48"W x 30"H' },
  // Wall - Tall (36"H)
  'W0936': { cab_type: 'wall', width: 9,  height: 36, label: '9"W x 36"H' },
  'W1236': { cab_type: 'wall', width: 12, height: 36, label: '12"W x 36"H' },
  'W1536': { cab_type: 'wall', width: 15, height: 36, label: '15"W x 36"H' },
  'W1836': { cab_type: 'wall', width: 18, height: 36, label: '18"W x 36"H' },
  'W2136': { cab_type: 'wall', width: 21, height: 36, label: '21"W x 36"H' },
  'W2436': { cab_type: 'wall', width: 24, height: 36, label: '24"W x 36"H' },
  'W2736': { cab_type: 'wall', width: 27, height: 36, label: '27"W x 36"H' },
  'W3036': { cab_type: 'wall', width: 30, height: 36, label: '30"W x 36"H' },
  'W3336': { cab_type: 'wall', width: 33, height: 36, label: '33"W x 36"H' },
  'W3636': { cab_type: 'wall', width: 36, height: 36, label: '36"W x 36"H' },
  'W3936': { cab_type: 'wall', width: 39, height: 36, label: '39"W x 36"H' },
  'W4236': { cab_type: 'wall', width: 42, height: 36, label: '42"W x 36"H' },
  'W4536': { cab_type: 'wall', width: 45, height: 36, label: '45"W x 36"H' },
  'W4836': { cab_type: 'wall', width: 48, height: 36, label: '48"W x 36"H' },
  // Wall - Tall (42"H)
  'W0942': { cab_type: 'wall', width: 9,  height: 42, label: '9"W x 42"H' },
  'W1242': { cab_type: 'wall', width: 12, height: 42, label: '12"W x 42"H' },
  'W1542': { cab_type: 'wall', width: 15, height: 42, label: '15"W x 42"H' },
  'W1842': { cab_type: 'wall', width: 18, height: 42, label: '18"W x 42"H' },
  'W2142': { cab_type: 'wall', width: 21, height: 42, label: '21"W x 42"H' },
  'W2442': { cab_type: 'wall', width: 24, height: 42, label: '24"W x 42"H' },
  'W2742': { cab_type: 'wall', width: 27, height: 42, label: '27"W x 42"H' },
  'W3042': { cab_type: 'wall', width: 30, height: 42, label: '30"W x 42"H' },
  'W3342': { cab_type: 'wall', width: 33, height: 42, label: '33"W x 42"H' },
  'W3642': { cab_type: 'wall', width: 36, height: 42, label: '36"W x 42"H' },
  'W3942': { cab_type: 'wall', width: 39, height: 42, label: '39"W x 42"H' },
  'W4242': { cab_type: 'wall', width: 42, height: 42, label: '42"W x 42"H' },
  'W4542': { cab_type: 'wall', width: 45, height: 42, label: '45"W x 42"H' },
  'W4842': { cab_type: 'wall', width: 48, height: 42, label: '48"W x 42"H' },
  // Wall - Short (above microwave / fridge: 12"~27"H)
  'W2412': { cab_type: 'wall', width: 24, height: 12, label: '24"W x 12"H' },
  'W3012': { cab_type: 'wall', width: 30, height: 12, label: '30"W x 12"H' },
  'W3312': { cab_type: 'wall', width: 33, height: 12, label: '33"W x 12"H' },
  'W3612': { cab_type: 'wall', width: 36, height: 12, label: '36"W x 12"H' },
  'W4212': { cab_type: 'wall', width: 42, height: 12, label: '42"W x 12"H' },
  'W4812': { cab_type: 'wall', width: 48, height: 12, label: '48"W x 12"H' },
  'W2415': { cab_type: 'wall', width: 24, height: 15, label: '24"W x 15"H' },
  'W3015': { cab_type: 'wall', width: 30, height: 15, label: '30"W x 15"H' },
  'W3315': { cab_type: 'wall', width: 33, height: 15, label: '33"W x 15"H' },
  'W3615': { cab_type: 'wall', width: 36, height: 15, label: '36"W x 15"H' },
  'W4215': { cab_type: 'wall', width: 42, height: 15, label: '42"W x 15"H' },
  'W4815': { cab_type: 'wall', width: 48, height: 15, label: '48"W x 15"H' },
  'W2418': { cab_type: 'wall', width: 24, height: 18, label: '24"W x 18"H' },
  'W3018': { cab_type: 'wall', width: 30, height: 18, label: '30"W x 18"H' },
  'W3618': { cab_type: 'wall', width: 36, height: 18, label: '36"W x 18"H' },
  'W4218': { cab_type: 'wall', width: 42, height: 18, label: '42"W x 18"H' },
  'W4818': { cab_type: 'wall', width: 48, height: 18, label: '48"W x 18"H' },
  'W2424': { cab_type: 'wall', width: 24, height: 24, label: '24"W x 24"H' },
  'W3024': { cab_type: 'wall', width: 30, height: 24, label: '30"W x 24"H' },
  'W3324': { cab_type: 'wall', width: 33, height: 24, label: '33"W x 24"H' },
  'W3624': { cab_type: 'wall', width: 36, height: 24, label: '36"W x 24"H' },
  'W4224': { cab_type: 'wall', width: 42, height: 24, label: '42"W x 24"H' },
  'W4824': { cab_type: 'wall', width: 48, height: 24, label: '48"W x 24"H' },
  'W3627': { cab_type: 'wall', width: 36, height: 27, label: '36"W x 27"H' },
  // Wall - Corner. The 30"H codes predate the 36"/42" ones and carry no
  // height; saved estimates use them, so they keep their names.
  // A diagonal corner's width is its reach along each wall. On site it is
  // measured by its angled door, 17" on the 24" box, so the label carries both.
  'WDC24':   { cab_type: 'wall', width: 24, height: 30, specialty: 'diagonal_corner_wall', label: 'Diagonal Corner 24"W x 30"H (17" door)' },
  'WDC27':   { cab_type: 'wall', width: 27, height: 30, specialty: 'diagonal_corner_wall', label: 'Diagonal Corner 27"W x 30"H' },
  'WDC2436': { cab_type: 'wall', width: 24, height: 36, specialty: 'diagonal_corner_wall', label: 'Diagonal Corner 24"W x 36"H (17" door)' },
  'WDC2442': { cab_type: 'wall', width: 24, height: 42, specialty: 'diagonal_corner_wall', label: 'Diagonal Corner 24"W x 42"H (17" door)' },
  'WDC2736': { cab_type: 'wall', width: 27, height: 36, specialty: 'diagonal_corner_wall', label: 'Diagonal Corner 27"W x 36"H' },
  'WDC2742': { cab_type: 'wall', width: 27, height: 42, specialty: 'diagonal_corner_wall', label: 'Diagonal Corner 27"W x 42"H' },
  // Easy-reach (pie-cut) corner: 24" along each wall, bi-fold doors
  'WER2430': { cab_type: 'wall', width: 24, height: 30, specialty: 'easy_reach_corner_wall', label: 'Easy Reach Corner 24"W x 30"H' },
  'WER2436': { cab_type: 'wall', width: 24, height: 36, specialty: 'easy_reach_corner_wall', label: 'Easy Reach Corner 24"W x 36"H' },
  'WER2442': { cab_type: 'wall', width: 24, height: 42, specialty: 'easy_reach_corner_wall', label: 'Easy Reach Corner 24"W x 42"H' },
  // Three-door corner: a 12"-deep upper at the open end of a run, its doors
  // wrapping that end (front, a 45° cut, the end). Width is along the wall.
  'WTD3030': { cab_type: 'wall', width: 30, height: 30, specialty: 'three_door_corner_wall', label: '3-Door End Corner 30"W x 30"H' },
  'WTD3036': { cab_type: 'wall', width: 30, height: 36, specialty: 'three_door_corner_wall', label: '3-Door End Corner 30"W x 36"H' },
  'WTD3042': { cab_type: 'wall', width: 30, height: 42, specialty: 'three_door_corner_wall', label: '3-Door End Corner 30"W x 42"H' },
  'WTD3330': { cab_type: 'wall', width: 33, height: 30, specialty: 'three_door_corner_wall', label: '3-Door End Corner 33"W x 30"H' },
  'WTD3336': { cab_type: 'wall', width: 33, height: 36, specialty: 'three_door_corner_wall', label: '3-Door End Corner 33"W x 36"H' },
  'WTD3342': { cab_type: 'wall', width: 33, height: 42, specialty: 'three_door_corner_wall', label: '3-Door End Corner 33"W x 42"H' },
  'WTD3630': { cab_type: 'wall', width: 36, height: 30, specialty: 'three_door_corner_wall', label: '3-Door End Corner 36"W x 30"H' },
  'WTD3636': { cab_type: 'wall', width: 36, height: 36, specialty: 'three_door_corner_wall', label: '3-Door End Corner 36"W x 36"H' },
  'WTD3642': { cab_type: 'wall', width: 36, height: 42, specialty: 'three_door_corner_wall', label: '3-Door End Corner 36"W x 42"H' },
  // Angle end upper: 12" along the wall at the open end of a run, cut back
  // at 45° to a point, one door on the cut. The wall twin of BEC24.
  'WEA1230': { cab_type: 'wall', width: 12, height: 30, specialty: 'angle_end_wall', label: 'Angle End Wall 12"W x 30"H' },
  'WEA1236': { cab_type: 'wall', width: 12, height: 36, specialty: 'angle_end_wall', label: 'Angle End Wall 12"W x 36"H' },
  'WEA1242': { cab_type: 'wall', width: 12, height: 42, specialty: 'angle_end_wall', label: 'Angle End Wall 12"W x 42"H' },
  // Two-door angle end: the same 12" x 12" with its front bent once, a door
  // on each of the two faces (Wolf WEC1230D).
  'WEA2D1230': { cab_type: 'wall', width: 12, height: 30, specialty: 'two_door_angle_end_wall', label: 'Angle End Wall 2-Door 12"W x 30"H' },
  'WEA2D1236': { cab_type: 'wall', width: 12, height: 36, specialty: 'two_door_angle_end_wall', label: 'Angle End Wall 2-Door 12"W x 36"H' },
  'WEA2D1242': { cab_type: 'wall', width: 12, height: 42, specialty: 'two_door_angle_end_wall', label: 'Angle End Wall 2-Door 12"W x 42"H' },
  // An angle end with a door on each face it shows — the front, the 45° cut
  // and the end: the three-door corner's wrap (WTD, 30-36") in the widths
  // below it. At 12" the three doors come out the same, about 7"; wider, the
  // front door takes the extra. No stock line carries it (see pricing.py).
  'WEA3D1230': { cab_type: 'wall', width: 12, height: 30, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 12"W x 30"H' },
  'WEA3D1236': { cab_type: 'wall', width: 12, height: 36, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 12"W x 36"H' },
  'WEA3D1242': { cab_type: 'wall', width: 12, height: 42, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 12"W x 42"H' },
  'WEA3D1530': { cab_type: 'wall', width: 15, height: 30, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 15"W x 30"H' },
  'WEA3D1536': { cab_type: 'wall', width: 15, height: 36, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 15"W x 36"H' },
  'WEA3D1542': { cab_type: 'wall', width: 15, height: 42, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 15"W x 42"H' },
  'WEA3D1830': { cab_type: 'wall', width: 18, height: 30, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 18"W x 30"H' },
  'WEA3D1836': { cab_type: 'wall', width: 18, height: 36, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 18"W x 36"H' },
  'WEA3D1842': { cab_type: 'wall', width: 18, height: 42, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 18"W x 42"H' },
  'WEA3D2130': { cab_type: 'wall', width: 21, height: 30, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 21"W x 30"H' },
  'WEA3D2136': { cab_type: 'wall', width: 21, height: 36, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 21"W x 36"H' },
  'WEA3D2142': { cab_type: 'wall', width: 21, height: 42, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 21"W x 42"H' },
  'WEA3D2430': { cab_type: 'wall', width: 24, height: 30, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 24"W x 30"H' },
  'WEA3D2436': { cab_type: 'wall', width: 24, height: 36, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 24"W x 36"H' },
  'WEA3D2442': { cab_type: 'wall', width: 24, height: 42, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 24"W x 42"H' },
  'WEA3D2730': { cab_type: 'wall', width: 27, height: 30, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 27"W x 30"H' },
  'WEA3D2736': { cab_type: 'wall', width: 27, height: 36, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 27"W x 36"H' },
  'WEA3D2742': { cab_type: 'wall', width: 27, height: 42, specialty: 'three_door_angle_end_wall', label: 'Angle End Wall 3-Door 27"W x 42"H' },
  'WBC24':  { cab_type: 'wall', width: 24, height: 30, specialty: 'blind_corner_wall', label: 'Blind Corner Wall 24"W x 30"H' },
  'WBC27':   { cab_type: 'wall', width: 27, height: 30, specialty: 'blind_corner_wall', label: 'Blind Corner Wall 27"W x 30"H' },
  'WBC30':   { cab_type: 'wall', width: 30, height: 30, specialty: 'blind_corner_wall', label: 'Blind Corner Wall 30"W x 30"H' },
  'WBC33':   { cab_type: 'wall', width: 33, height: 30, specialty: 'blind_corner_wall', label: 'Blind Corner Wall 33"W x 30"H' },
  'WBC2436': { cab_type: 'wall', width: 24, height: 36, specialty: 'blind_corner_wall', label: 'Blind Corner Wall 24"W x 36"H' },
  'WBC2736': { cab_type: 'wall', width: 27, height: 36, specialty: 'blind_corner_wall', label: 'Blind Corner Wall 27"W x 36"H' },
  'WBC3036': { cab_type: 'wall', width: 30, height: 36, specialty: 'blind_corner_wall', label: 'Blind Corner Wall 30"W x 36"H' },
  'WBC3336': { cab_type: 'wall', width: 33, height: 36, specialty: 'blind_corner_wall', label: 'Blind Corner Wall 33"W x 36"H' },
  'WBC2442': { cab_type: 'wall', width: 24, height: 42, specialty: 'blind_corner_wall', label: 'Blind Corner Wall 24"W x 42"H' },
  'WBC2742': { cab_type: 'wall', width: 27, height: 42, specialty: 'blind_corner_wall', label: 'Blind Corner Wall 27"W x 42"H' },
  'WBC3042': { cab_type: 'wall', width: 30, height: 42, specialty: 'blind_corner_wall', label: 'Blind Corner Wall 30"W x 42"H' },
  'WBC3342': { cab_type: 'wall', width: 33, height: 42, specialty: 'blind_corner_wall', label: 'Blind Corner Wall 33"W x 42"H' },
  // Wall - OTR microwave cabinet (18"H with cut-out + venting)
  'WMW30': { cab_type: 'wall', width: 30, height: 18, specialty: 'otr_microwave_wall', label: 'OTR Microwave 30"' },
  'WMW33': { cab_type: 'wall', width: 33, height: 18, specialty: 'otr_microwave_wall', label: 'OTR Microwave 33"' },
  'WMW36': { cab_type: 'wall', width: 36, height: 18, specialty: 'otr_microwave_wall', label: 'OTR Microwave 36"' },
  // Wall - Deep upper over a refrigerator (24" deep, not 12")
  'WRD30': { cab_type: 'wall', width: 30, height: 24, specialty: 'refrigerator_wall_deep', label: 'Fridge Deep Upper 30"' },
  'WRD33': { cab_type: 'wall', width: 33, height: 24, specialty: 'refrigerator_wall_deep', label: 'Fridge Deep Upper 33"' },
  'WRD36': { cab_type: 'wall', width: 36, height: 24, specialty: 'refrigerator_wall_deep', label: 'Fridge Deep Upper 36"' },
  'WRD42': { cab_type: 'wall', width: 42, height: 24, specialty: 'refrigerator_wall_deep', label: 'Fridge Deep Upper 42"' },
  // Tall - Pantry (widths 18/24/30/36 x heights 84/90/96)
  'T1884': { cab_type: 'tall', width: 18, height: 84, label: 'Tall 18"x84"' },
  'T2484': { cab_type: 'tall', width: 24, height: 84, label: 'Tall 24"x84"' },
  'T3084': { cab_type: 'tall', width: 30, height: 84, label: 'Tall 30"x84"' },
  'T3684': { cab_type: 'tall', width: 36, height: 84, label: 'Tall 36"x84"' },
  'T1890': { cab_type: 'tall', width: 18, height: 90, label: 'Tall 18"x90"' },
  'T2490': { cab_type: 'tall', width: 24, height: 90, label: 'Tall 24"x90"' },
  'T3090': { cab_type: 'tall', width: 30, height: 90, label: 'Tall 30"x90"' },
  'T3690': { cab_type: 'tall', width: 36, height: 90, label: 'Tall 36"x90"' },
  'T1896': { cab_type: 'tall', width: 18, height: 96, label: 'Tall 18"x96"' },
  'T2496': { cab_type: 'tall', width: 24, height: 96, label: 'Tall 24"x96"' },
  'T3096': { cab_type: 'tall', width: 30, height: 96, label: 'Tall 30"x96"' },
  'T3696': { cab_type: 'tall', width: 36, height: 96, label: 'Tall 36"x96"' },
  // Tall - Pantry, non-standard width (38")
  'T3884': { cab_type: 'tall', width: 38, height: 84, label: 'Tall 38"x84"' },
  'T3890': { cab_type: 'tall', width: 38, height: 90, label: 'Tall 38"x90"' },
  'T3896': { cab_type: 'tall', width: 38, height: 96, label: 'Tall 38"x96"' },
  // Tall - Oven (widths 30/33 x heights 84/90/96)
  'OC3084': { cab_type: 'tall', width: 30, height: 84, specialty: 'oven_cabinet', label: 'Oven Cabinet 30"x84"' },
  'OC3090': { cab_type: 'tall', width: 30, height: 90, specialty: 'oven_cabinet', label: 'Oven Cabinet 30"x90"' },
  'OC3096': { cab_type: 'tall', width: 30, height: 96, specialty: 'oven_cabinet', label: 'Oven Cabinet 30"x96"' },
  'OC3384': { cab_type: 'tall', width: 33, height: 84, specialty: 'oven_cabinet', label: 'Oven Cabinet 33"x84"' },
  'OC3390': { cab_type: 'tall', width: 33, height: 90, specialty: 'oven_cabinet', label: 'Oven Cabinet 33"x90"' },
  'OC3396': { cab_type: 'tall', width: 33, height: 96, specialty: 'oven_cabinet', label: 'Oven Cabinet 33"x96"' },
  // Tall - Refrigerator (widths 33/36 x heights 84/90/96)
  'RC3384': { cab_type: 'tall', width: 33, height: 84, specialty: 'refrigerator_cabinet', label: 'Fridge Cabinet 33"x84"' },
  'RC3390': { cab_type: 'tall', width: 33, height: 90, specialty: 'refrigerator_cabinet', label: 'Fridge Cabinet 33"x90"' },
  'RC3396': { cab_type: 'tall', width: 33, height: 96, specialty: 'refrigerator_cabinet', label: 'Fridge Cabinet 33"x96"' },
  'RC3684': { cab_type: 'tall', width: 36, height: 84, specialty: 'refrigerator_cabinet', label: 'Fridge Cabinet 36"x84"' },
  'RC3690': { cab_type: 'tall', width: 36, height: 90, specialty: 'refrigerator_cabinet', label: 'Fridge Cabinet 36"x90"' },
  'RC3696': { cab_type: 'tall', width: 36, height: 96, specialty: 'refrigerator_cabinet', label: 'Fridge Cabinet 36"x96"' },
  // Tall - Double oven / oven+microwave stack (taller cut-out)
  'DOC3084': { cab_type: 'tall', width: 30, height: 84, specialty: 'double_oven_cabinet', label: 'Double Oven 30"x84"' },
  'DOC3090': { cab_type: 'tall', width: 30, height: 90, specialty: 'double_oven_cabinet', label: 'Double Oven 30"x90"' },
  'DOC3384': { cab_type: 'tall', width: 33, height: 84, specialty: 'double_oven_cabinet', label: 'Double Oven 33"x84"' },
  'DOC3390': { cab_type: 'tall', width: 33, height: 90, specialty: 'double_oven_cabinet', label: 'Double Oven 33"x90"' },
  // Tall - Pantry with roll-out trays
  'PRO2484': { cab_type: 'tall', width: 24, height: 84, specialty: 'pantry_rollout', label: 'Pantry Roll-out 24"x84"' },
  'PRO3084': { cab_type: 'tall', width: 30, height: 84, specialty: 'pantry_rollout', label: 'Pantry Roll-out 30"x84"' },
  'PRO3384': { cab_type: 'tall', width: 33, height: 84, specialty: 'pantry_rollout', label: 'Pantry Roll-out 33"x84"' },
  'PRO3684': { cab_type: 'tall', width: 36, height: 84, specialty: 'pantry_rollout', label: 'Pantry Roll-out 36"x84"' },
};

const CUSTOM_VALUE = '__custom__';

export type SectionType = 'base' | 'wall' | 'tall';

const SECTION_CONFIG: { type: SectionType; label: string; color: string; unit: string }[] = [
  { type: 'base', label: 'Base Cabinets', color: 'blue', unit: 'LF' },
  { type: 'wall', label: 'Wall Cabinets', color: 'green', unit: 'LF' },
  { type: 'tall', label: 'Tall Cabinets', color: 'orange', unit: 'EA' },
];

/**
 * Full height of a kitchen's uppers, which the Wall pickers are narrowed to.
 * The short uppers over a fridge, range or OTR microwave (under 30") are
 * listed whatever it is. 'all' while there's no Tier and no upper to go by.
 */
export type WallHeightFilter = 'all' | 30 | 36 | 42;

export const WALL_HEIGHT_OPTIONS: { label: string; value: WallHeightFilter }[] = [
  { label: '30"', value: 30 },
  { label: '36"', value: 36 },
  { label: '42"', value: 42 },
];

/**
 * The upper height a Tier starts at: older and builder-grade kitchens hang
 * 30" uppers, most kitchens 36", newer and high-end ones 42". It can be
 * changed by hand on the Edit tab.
 */
export const TIER_WALL_HEIGHT: Record<CabinetTier, 30 | 36 | 42> = {
  Stock: 30,
  'Semi-Custom': 36,
  Custom: 42,
};

export const wallHeightForTier = (tier?: string | null): WallHeightFilter =>
  (tier && TIER_WALL_HEIGHT[tier as CabinetTier]) || 'all';

export const matchesWallHeight = (height: number, filter: WallHeightFilter) =>
  filter === 'all' || height < 30 || height === filter;

const FULL_WALL_HEIGHTS = [30, 36, 42] as const;
type FullWallHeight = (typeof FULL_WALL_HEIGHTS)[number];
const isFullWallHeight = (height: number): height is FullWallHeight =>
  (FULL_WALL_HEIGHTS as readonly number[]).includes(height);

/**
 * The full height most of `boxes`' uppers are (counted by qty, custom sizes
 * too), or null when none is 30", 36" or 42". A tie goes to the shorter.
 */
export function mainWallHeight(boxes: CabinetBoxCreate[]): FullWallHeight | null {
  const count = new Map<FullWallHeight, number>();
  for (const box of boxes) {
    if (box.cab_type !== 'wall' || !isFullWallHeight(box.height_inches)) continue;
    count.set(box.height_inches, (count.get(box.height_inches) ?? 0) + box.qty);
  }
  let best: FullWallHeight | null = null;
  for (const height of FULL_WALL_HEIGHTS) {
    if ((count.get(height) ?? 0) > (best === null ? 0 : count.get(best)!)) best = height;
  }
  return best;
}

/**
 * The same full-height upper (width and kind) at `height`; null for a
 * short upper, a custom size, one already that tall, or a size the catalog
 * doesn't make at that height.
 */
export function wallPresetAtHeight(code: string, height: number): string | null {
  const preset = CABINET_PRESETS[code];
  if (!preset || preset.cab_type !== 'wall' || !isFullWallHeight(preset.height) || preset.height === height) {
    return null;
  }
  const twin = Object.entries(CABINET_PRESETS).find(
    ([, v]) =>
      v.cab_type === 'wall' &&
      v.width === preset.width &&
      v.height === height &&
      (v.specialty ?? null) === (preset.specialty ?? null)
  );
  return twin ? twin[0] : null;
}

/**
 * `boxes` with every full-height upper switched to `height` (see
 * wallPresetAtHeight); `moved` counts the cabinets switched (qty).
 */
export function boxesAtWallHeight(boxes: CabinetBoxCreate[], height: number) {
  let moved = 0;
  const next = boxes.map((box) => {
    const code = box.cab_type === 'wall' ? wallPresetAtHeight(box.code, height) : null;
    if (!code) return box;
    moved += box.qty;
    return { ...box, code, height_inches: CABINET_PRESETS[code].height };
  });
  return { boxes: next, moved };
}

export function getOptionsForType(cabType: SectionType, wallHeight: WallHeightFilter = 'all') {
  const entries = Object.entries(CABINET_PRESETS).filter(
    ([, v]) => v.cab_type === cabType && (cabType !== 'wall' || matchesWallHeight(v.height, wallHeight))
  );

  if (cabType === 'base') {
    return [
      {
        label: 'Base',
        options: entries
          .filter(([, v]) => !v.specialty)
          .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
      },
      {
        label: 'Specialty',
        options: entries
          .filter(([, v]) => v.specialty)
          .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
      },
      { label: 'Other', options: [{ label: '+ Custom Size...', value: CUSTOM_VALUE }] },
    ];
  }

  if (cabType === 'tall') {
    return [
      {
        label: 'Pantry',
        options: entries
          .filter(([, v]) => !v.specialty)
          .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
      },
      {
        label: 'Oven',
        options: entries
          .filter(([, v]) => v.specialty === 'oven_cabinet')
          .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
      },
      {
        label: 'Refrigerator',
        options: entries
          .filter(([, v]) => v.specialty === 'refrigerator_cabinet')
          .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
      },
      { label: 'Other', options: [{ label: '+ Custom Size...', value: CUSTOM_VALUE }] },
    ];
  }

  // wall — groups the height filter emptied are dropped
  return [
    {
      label: 'Standard (30"H)',
      options: entries
        .filter(([, v]) => v.height === 30 && !v.specialty)
        .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
    },
    {
      label: 'Tall (36"H)',
      options: entries
        .filter(([, v]) => v.height === 36 && !v.specialty)
        .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
    },
    {
      label: 'Extra Tall (42"H)',
      options: entries
        .filter(([, v]) => v.height === 42 && !v.specialty)
        .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
    },
    {
      label: 'Short — Above Microwave/Fridge (12"-27"H)',
      options: entries
        .filter(([, v]) => v.height < 30 && !v.specialty)
        .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
    },
    {
      label: 'Specialty',
      options: entries
        .filter(([, v]) => v.specialty)
        .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
    },
    { label: 'Other', options: [{ label: '+ Custom Size...', value: CUSTOM_VALUE }] },
  ].filter((group) => group.options.length > 0);
}

interface CabinetBoxEditorProps {
  boxes: CabinetBoxCreate[];
  onChange: (boxes: CabinetBoxCreate[]) => void;
  location: CabinetLocation;
  /** Narrows the Wall pickers to one upper height (shared with the Sketch tab). */
  wallHeight?: WallHeightFilter;
  /** Shows the Upper height control on the Wall section when given. */
  onWallHeightChange?: (height: WallHeightFilter) => void;
  /** The estimate's Tier, whose usual upper height is named when another is picked. */
  tier?: string | null;
  /**
   * Linking rows to the sketch beside the form: `keyOf` names a row's
   * cabinets on the sketch (boxKey), `linked` holds the keys selected there,
   * and a row reports a click (`onPick`) and the pointer coming and going (`onHover`).
   */
  link?: {
    keyOf: (box: CabinetBoxCreate) => string;
    linked: ReadonlySet<string>;
    onPick: (key: string) => void;
    onHover: (key: string | null) => void;
    /** The row whose cabinets the pointer is over on the plan, if any. */
    hinted?: string | null;
  };
  /**
   * 'list' beside the sketch: a line per row (code, name, qty), edited by
   * picking it and changing it in Inspect. 'table' (default) edits every column in place.
   */
  variant?: 'table' | 'list';
}

// A click on these inside a row edits the row; anywhere else it picks the row's cabinets on the sketch.
const ROW_CONTROLS = 'input, button, a, textarea, .ant-select, .ant-input-number, .ant-checkbox-wrapper, .ant-segmented';

const CabinetBoxEditor: React.FC<CabinetBoxEditorProps> = ({
  boxes,
  onChange,
  location,
  wallHeight = 'all',
  onWallHeightChange,
  tier,
  link,
  variant = 'table',
}) => {
  const tierWallHeight = wallHeightForTier(tier);
  const addBox = (cabType: SectionType, codeOrCustom: string) => {
    if (codeOrCustom === CUSTOM_VALUE) {
      const defaults: Record<SectionType, { width: number; height: number }> = {
        base: { width: 24, height: 34.5 },
        wall: { width: 24, height: typeof wallHeight === 'number' ? wallHeight : 30 },
        tall: { width: 24, height: 84 },
      };
      const newBox: CabinetBoxCreate = {
        code: 'CUSTOM',
        cab_type: cabType,
        location,
        width_inches: defaults[cabType].width,
        height_inches: defaults[cabType].height,
        is_specialty: false,
        specialty_type: null,
        has_glass_door: false,
        qty: 1,
        display_order: boxes.length,
      };
      onChange([...boxes, newBox]);
      return;
    }
    const preset = CABINET_PRESETS[codeOrCustom];
    if (!preset) return;
    const newBox: CabinetBoxCreate = {
      code: codeOrCustom,
      cab_type: preset.cab_type,
      location,
      width_inches: preset.width,
      height_inches: preset.height,
      is_specialty: !!preset.specialty,
      specialty_type: preset.specialty || null,
      has_glass_door: false,
      range_panel_count:
        preset.specialty === 'range_base_slide_in' ? 2 : null,
      qty: 1,
      display_order: boxes.length,
    };
    onChange([...boxes, newBox]);
  };

  // Get the global index in boxes array for a given type-filtered item
  const getGlobalIndex = (cabType: SectionType, localIndex: number): number => {
    let count = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].cab_type === cabType) {
        if (count === localIndex) return i;
        count++;
      }
    }
    return -1;
  };

  const updateBox = (globalIndex: number, updates: Partial<CabinetBoxCreate>) => {
    const updated = [...boxes];
    updated[globalIndex] = { ...updated[globalIndex], ...updates };
    onChange(updated);
  };

  const handleCodeChange = (globalIndex: number, value: string, cabType: SectionType) => {
    if (value === CUSTOM_VALUE) {
      const defaults: Record<SectionType, { width: number; height: number }> = {
        base: { width: 24, height: 34.5 },
        wall: { width: 24, height: typeof wallHeight === 'number' ? wallHeight : 30 },
        tall: { width: 24, height: 84 },
      };
      updateBox(globalIndex, {
        code: 'CUSTOM',
        cab_type: cabType,
        width_inches: defaults[cabType].width,
        height_inches: defaults[cabType].height,
        is_specialty: false,
        specialty_type: null,
        has_glass_door: false,
        door_pattern: null,
      });
      return;
    }
    const preset = CABINET_PRESETS[value];
    if (preset) {
      updateBox(globalIndex, {
        code: value,
        cab_type: preset.cab_type,
        width_inches: preset.width,
        height_inches: preset.height,
        is_specialty: !!preset.specialty,
        specialty_type: preset.specialty || null,
        range_panel_count:
          preset.specialty === 'range_base_slide_in' ? 2 : null,
      });
    }
  };

  const removeBox = (globalIndex: number) => {
    onChange(boxes.filter((_, i) => i !== globalIndex));
  };

  const isCustom = (record: CabinetBoxCreate) => !CABINET_PRESETS[record.code];

  // A row keeps its own cabinet in its list even when the height filter
  // hides it, so the select shows the name rather than a bare code.
  const optionsForRow = (record: CabinetBoxCreate, options: ReturnType<typeof getOptionsForType>) => {
    const preset = CABINET_PRESETS[record.code];
    if (!preset || preset.cab_type !== 'wall' || matchesWallHeight(preset.height, wallHeight)) return options;
    return [{ label: 'Current', options: [{ label: `${record.code} — ${preset.label}`, value: record.code }] }, ...options];
  };

  // Summary
  const baseLF = boxes.filter(b => b.cab_type === 'base').reduce((sum, b) => sum + (b.width_inches * b.qty) / 12, 0);
  const wallLF = boxes.filter(b => b.cab_type === 'wall').reduce((sum, b) => sum + (b.width_inches * b.qty) / 12, 0);
  const tallCount = boxes.filter(b => b.cab_type === 'tall').reduce((sum, b) => sum + b.qty, 0);
  const totalBoxes = boxes.reduce((sum, b) => sum + b.qty, 0);

  const makeColumns = (cabType: SectionType, options: ReturnType<typeof getOptionsForType>) => [
    {
      title: 'Cabinet',
      dataIndex: 'code',
      width: 220,
      render: (_: string, record: CabinetBoxCreate & { _localIdx: number }) => {
        const gi = getGlobalIndex(cabType, record._localIdx);
        return (
          <Select
            showSearch
            value={CABINET_PRESETS[record.code] ? record.code : CUSTOM_VALUE}
            style={{ width: 200 }}
            onChange={(val) => handleCodeChange(gi, val, cabType)}
            options={optionsForRow(record, options)}
            filterOption={(input, option) =>
              (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
            }
            popupMatchSelectWidth={280}
          />
        );
      },
    },
    {
      title: 'W"',
      dataIndex: 'width_inches',
      width: 58,
      render: (_: number, record: CabinetBoxCreate & { _localIdx: number }) => {
        const gi = getGlobalIndex(cabType, record._localIdx);
        return isCustom(record) ? (
          <InputNumber
            value={record.width_inches}
            min={6} max={60}
            size="small"
            style={{ width: 60 }}
            onChange={(val) => val && updateBox(gi, { width_inches: val })}
          />
        ) : (
          <Text>{record.width_inches}"</Text>
        );
      },
    },
    {
      title: 'H"',
      dataIndex: 'height_inches',
      width: 58,
      render: (_: number, record: CabinetBoxCreate & { _localIdx: number }) => {
        const gi = getGlobalIndex(cabType, record._localIdx);
        return isCustom(record) ? (
          <InputNumber
            value={record.height_inches}
            min={6} max={120} step={0.5}
            size="small"
            style={{ width: 60 }}
            onChange={(val) => val && updateBox(gi, { height_inches: val })}
          />
        ) : (
          <Text>{record.height_inches}"</Text>
        );
      },
    },
    ...(cabType !== 'wall' ? [{
      title: 'Specialty',
      dataIndex: 'specialty_type',
      width: 98,
      render: (_: string, record: CabinetBoxCreate) => (
        record.is_specialty && record.specialty_type ? (
          <span>{specialtyName(record.specialty_type as SpecialtyType)}</span>
        ) : <Text type="secondary">None</Text>
      ),
    }] : []),
    // Only a slide-in range has panels; the column makes room for the rest when there is none.
    ...(cabType === 'base' && boxes.some((b) => b.cab_type === 'base' && b.specialty_type === 'range_base_slide_in') ? [{
      title: 'Panels',
      dataIndex: 'range_panel_count',
      width: 90,
      render: (_: number, record: CabinetBoxCreate & { _localIdx: number }) => {
        if (record.specialty_type !== 'range_base_slide_in') {
          return <Text type="secondary">—</Text>;
        }
        const gi = getGlobalIndex(cabType, record._localIdx);
        return (
          <Tooltip title="Finished end panels flanking the range opening">
            <Select
              size="small"
              style={{ width: 60 }}
              value={record.range_panel_count ?? 2}
              onChange={(v: number) => updateBox(gi, { range_panel_count: v })}
              options={[
                { label: '0', value: 0 },
                { label: '1', value: 1 },
                { label: '2', value: 2 },
              ]}
            />
          </Tooltip>
        );
      },
    }] : []),
    ...((cabType === 'wall' || cabType === 'base') ? [{
      title: 'Glass',
      dataIndex: 'has_glass_door',
      width: 52,
      render: (_: boolean, record: CabinetBoxCreate & { _localIdx: number }) => {
        const gi = getGlobalIndex(cabType, record._localIdx);
        return (
          <Tooltip title="Glass door insert">
            <Checkbox
              checked={record.has_glass_door}
              onChange={(e) =>
                // Mullions without their glass are no door we offer: back to plain.
                updateBox(
                  gi,
                  !e.target.checked && record.door_pattern === 'mullion'
                    ? { has_glass_door: false, door_pattern: null }
                    : { has_glass_door: e.target.checked }
                )
              }
            />
          </Tooltip>
        );
      },
    }] : []),
    {
      title: 'Door',
      dataIndex: 'door_pattern',
      width: 134,
      render: (_: DoorPattern | null | undefined, record: CabinetBoxCreate & { _localIdx: number }) => {
        if (record.specialty_type && NO_DOOR_SPECIALTIES.includes(record.specialty_type)) {
          return <Text type="secondary">—</Text>;
        }
        const gi = getGlobalIndex(cabType, record._localIdx);
        return (
          <Tooltip
            title={
              cabType === 'tall'
                ? "A pattern in the door's frame, priced per door. Lattice + oval band makes each row of doors one panel; the drawer and the oven or fridge opening stay as they are."
                : "A pattern in the door's frame, priced per door. Lattice + oval band makes the whole front one panel. Mullions are a grid of bars over glass, so picking them ticks Glass; for a lattice, tick Glass as well for glass behind it."
            }
          >
            <Select
              size="small"
              style={{ width: 118 }}
              popupMatchSelectWidth={190}
              value={record.door_pattern ?? PLAIN_DOOR}
              onChange={(v: DoorPattern | typeof PLAIN_DOOR) =>
                updateBox(
                  gi,
                  v === 'mullion'
                    ? { door_pattern: v, has_glass_door: true }
                    : { door_pattern: v === PLAIN_DOOR ? null : v }
                )
              }
              options={cabType === 'tall' ? TALL_DOOR_PATTERN_OPTIONS : DOOR_PATTERN_OPTIONS}
              labelRender={(p) => DOOR_PATTERN_OPTIONS.find((o) => o.value === p.value)?.short ?? p.label}
            />
          </Tooltip>
        );
      },
    },
    {
      title: 'Qty',
      dataIndex: 'qty',
      width: 80,
      render: (_: number, record: CabinetBoxCreate & { _localIdx: number }) => {
        const gi = getGlobalIndex(cabType, record._localIdx);
        return (
          <InputNumber
            value={record.qty}
            min={1} max={50}
            size="small"
            style={{ width: 65 }}
            onChange={(val) => val && updateBox(gi, { qty: val })}
          />
        );
      },
    },
    {
      title: '',
      key: 'action',
      width: 40,
      render: (_: any, record: CabinetBoxCreate & { _localIdx: number }) => {
        const gi = getGlobalIndex(cabType, record._localIdx);
        return (
          <Button
            size="small"
            type="text"
            className="ui-icon-btn ui-icon-btn--danger"
            icon={<DeleteOutlined />}
            aria-label={`Remove ${record.code}`}
            onClick={() => removeBox(gi)}
          />
        );
      },
    },
  ];

  // The Upper height control, on the Wall section.
  const upperHeight = (compact: boolean) => (
    <Space size={6} style={compact ? undefined : { marginLeft: 8 }} wrap>
      <Tooltip title={`Starts at the Tier's height (Stock 30", Semi-Custom 36", Custom 42") and can be changed here. The Wall pickers list this height and the short uppers over a fridge, range or microwave.`}>
        <Text type="secondary" style={{ fontSize: 13 }}>Upper height</Text>
      </Tooltip>
      <Segmented<WallHeightFilter>
        size="small"
        value={wallHeight}
        onChange={onWallHeightChange}
        options={WALL_HEIGHT_OPTIONS}
      />
      {tierWallHeight !== 'all' && wallHeight !== tierWallHeight && (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {tier} is usually {tierWallHeight}"
        </Text>
      )}
    </Space>
  );

  // Beside the sketch: each row a line in a list (code, name, qty), picked to edit it in Inspect.
  const renderListSection = (config: typeof SECTION_CONFIG[number]) => {
    const { type, label } = config;
    const sectionBoxes = boxes.filter((b) => b.cab_type === type).map((b, i) => ({ ...b, _localIdx: i }));
    const options = getOptionsForType(type, wallHeight);
    const summary = type === 'tall'
      ? `${sectionBoxes.reduce((s, b) => s + b.qty, 0)} EA`
      : `${sectionBoxes.reduce((s, b) => s + (b.width_inches * b.qty) / 12, 0).toFixed(1)} LF`;
    const noun = label.replace(' Cabinets', '').toLowerCase();
    return (
      <div key={type} className="ce-section">
        <div className="ce-section-title">
          <span>{location === 'island' ? `Island ${noun}` : label.replace(' Cabinets', '')}</span>
          <span className="ce-section-meta">{summary}</span>
        </div>
        {type === 'wall' && onWallHeightChange && <div style={{ margin: '2px 0 6px' }}>{upperHeight(true)}</div>}
        {sectionBoxes.map((record) => {
          const gi = getGlobalIndex(type, record._localIdx);
          const key = link?.keyOf(record);
          const preset = CABINET_PRESETS[record.code];
          const name = [
            preset?.label ?? `Custom ${record.width_inches}" × ${record.height_inches}"`,
            record.has_glass_door ? 'glass' : null,
            record.door_pattern ? DOOR_PATTERN_OPTIONS.find((o) => o.value === record.door_pattern)?.short ?? null : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const picked = !!key && !!link?.linked.has(key);
          return (
            <div
              key={gi}
              className={`ce-row${picked ? ' is-selected' : ''}${key && link?.hinted === key ? ' is-hinted' : ''}`}
              data-link-key={key}
              onMouseEnter={() => key && link?.onHover(key)}
              onMouseLeave={() => link?.onHover(null)}
            >
              <button
                type="button"
                className="ce-row is-link"
                style={{ flex: 1, width: 'auto', margin: 0, padding: 0, minHeight: 0, background: 'none' }}
                aria-pressed={picked}
                title={link ? 'Pick it on the plan to change it' : undefined}
                onClick={() => key && link?.onPick(key)}
              >
                <span className="ce-row-code">{record.code === 'CUSTOM' ? 'Custom' : record.code}</span>
                <span className="ce-row-name">{name}</span>
              </button>
              <InputNumber
                size="small"
                aria-label={`How many ${record.code}`}
                value={record.qty}
                min={1}
                max={50}
                onChange={(val) => val && updateBox(gi, { qty: val })}
              />
              <Button
                size="small"
                type="text"
                className="ui-icon-btn ui-icon-btn--danger ce-row-remove"
                icon={<DeleteOutlined />}
                aria-label={`Remove ${record.code}`}
                onClick={() => removeBox(gi)}
              />
            </div>
          );
        })}
        <Select
          className="ce-add"
          aria-label={`Add a ${noun} cabinet`}
          placeholder={`Add ${location === 'island' ? 'an island' : 'a'} ${noun} cabinet…`}
          showSearch
          value={null}
          onChange={(val: string) => addBox(type, val)}
          options={options}
          filterOption={(input, option) =>
            (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
          }
          popupMatchSelectWidth={300}
        />
      </div>
    );
  };

  const renderSection = (config: typeof SECTION_CONFIG[number]) => {
    const { type, label } = config;
    const sectionBoxes = boxes
      .filter(b => b.cab_type === type)
      .map((b, i) => ({ ...b, _localIdx: i, key: i }));
    const options = getOptionsForType(type, wallHeight);

    const summary = type === 'tall'
      ? `${sectionBoxes.reduce((s, b) => s + b.qty, 0)} EA`
      : `${sectionBoxes.reduce((s, b) => s + (b.width_inches * b.qty) / 12, 0).toFixed(1)} LF`;

    return (
      <div key={type} style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <Text strong style={{ fontSize: 14 }}>{label}</Text>
          <Text type="secondary" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{summary}</Text>
          {type === 'wall' && onWallHeightChange && upperHeight(false)}
        </div>

        {sectionBoxes.length > 0 && (
          <Table
            dataSource={sectionBoxes}
            columns={makeColumns(type, options)}
            pagination={false}
            size="small"
            // Its own columns' width: a set width smaller than theirs squeezed W" and H" till they wrapped.
            scroll={{ x: 'max-content' }}
            rowClassName={(record) =>
              link && link.linked.has(link.keyOf(record)) ? 'ant-table-row-selected' : ''
            }
            onRow={
              link
                ? (record) => {
                    const key = link.keyOf(record);
                    return {
                      // Found by the page, to bring the row into view when its cabinet is picked on the sketch.
                      'data-link-key': key,
                      style: { cursor: 'pointer' },
                      onClick: (e: React.MouseEvent) => {
                        if (!(e.target as HTMLElement).closest(ROW_CONTROLS)) link.onPick(key);
                      },
                      onMouseEnter: () => link.onHover(key),
                      onMouseLeave: () => link.onHover(null),
                    } as React.HTMLAttributes<HTMLElement>;
                  }
                : undefined
            }
          />
        )}

        <Select
          aria-label={`Add a ${label.replace(' Cabinets', '').toLowerCase()} cabinet`}
          placeholder={`Add a ${label.replace(' Cabinets', '').toLowerCase()} cabinet…`}
          style={{ width: 260, marginTop: sectionBoxes.length > 0 ? 8 : 0 }}
          showSearch
          // Controlled and always empty: left uncontrolled (undefined) it kept
          // the last pick, so picking the same cabinet again was no change
          // and added nothing.
          value={null}
          onChange={(val: string) => addBox(type, val)}
          options={options}
          filterOption={(input, option) =>
            (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
          }
          popupMatchSelectWidth={300}
        />
      </div>
    );
  };

  const isIsland = location === 'island';
  const sections = isIsland
    ? SECTION_CONFIG.filter(s => s.type === 'base')
    : SECTION_CONFIG;

  if (variant === 'list') return <div>{sections.map(renderListSection)}</div>;

  return (
    <div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        {[
          `Base ${baseLF.toFixed(1)} LF`,
          !isIsland && `Wall ${wallLF.toFixed(1)} LF`,
          !isIsland && `Tall ${tallCount} EA`,
          `${totalBoxes} ${totalBoxes === 1 ? 'box' : 'boxes'}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>

      {sections.map(renderSection)}
    </div>
  );
};

export default CabinetBoxEditor;
