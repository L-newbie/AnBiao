// Preset tag vocabulary for UploadSheet. The upload tag dropdown is no longer
// fed by what's already been used (that degenerated into a self-reinforcing
// loop: the first users' tags became everyone's tags). This is a designer-curated
// set organized by life-scene, so people have real starting points but can
// still type anything custom.
//
// The `existingTags` prop is still accepted by UploadSheet as a fallback for
// discoverability of what already exists, but preset tags always display first.

export const TAG_PRESETS = [
  // 夜行
  '夜行', '深夜', '凌晨', '夜游', '兜风', '漫步',
  // 放松身心
  '按摩', '泡浴', '桑拿', '足疗', '针灸', 'SPA',
  // 吃喝
  '小酌', '夜宵', '串烧', '小馆', '深夜小酒', '麻辣烫',
  // 更小隐晦一点（暗示性但不露骨）
  '足浴', '不打烊', '深夜小酌', '微醺',
  // 场景
  '巷尾', '小旅店', '私厨', '转角小店', '天台', '江边',
  // 情绪与小仪式
  '随手拍', '仪式感', '一时兴起', '心血来潮', '半推半就',
]
