(function buildTarotDeck() {
  "use strict";

  const COMMONS_CATEGORY =
    "https://commons.wikimedia.org/wiki/Category:Rider-Waite-Smith_tarot_deck_(TaionWC)";

  const MAJOR = [
    ["00", "0", "愚者", "The Fool", "开放 · 新起点 · 信任", "迟疑 · 冒进 · 分心", "给未知留出位置，以轻装但清醒的姿态迈出第一步。", "先确认脚下与边界；勇气不等于忽略风险。", "Fool"],
    ["01", "I", "魔术师", "The Magician", "意志 · 资源 · 行动", "分散 · 操控 · 未兑现", "你已经拥有足够的工具，把注意力放回可执行的动作。", "能力没有消失，但动机与资源需要重新对齐。", "Magician"],
    ["02", "II", "女祭司", "The High Priestess", "直觉 · 静观 · 未言之物", "封闭 · 噪声 · 忽略直觉", "暂缓解释，倾听尚未被语言整理的感受。", "外部声音过强，安静下来才能辨认自己的判断。", "High Priestess"],
    ["03", "III", "女皇", "The Empress", "滋养 · 丰盛 · 创造", "透支 · 停滞 · 自我忽视", "让事物生长，始于给它时间、空间和真实照料。", "照顾他人之前，先检查自己是否仍有余裕。", "Empress"],
    ["04", "IV", "皇帝", "The Emperor", "结构 · 边界 · 责任", "僵化 · 控制 · 权威冲突", "建立清楚的规则，让力量服务于稳定和长期目标。", "结构正在变成束缚，需要区分秩序与控制。", "Emperor"],
    ["05", "V", "教皇", "The Hierophant", "传统 · 学习 · 共同信念", "反叛 · 教条 · 自我定义", "从可靠的知识与经验中学习，再决定如何实践。", "旧规则未必仍适用，是时候形成自己的价值框架。", "Hierophant"],
    ["06", "VI", "恋人", "The Lovers", "选择 · 联结 · 一致", "分歧 · 失衡 · 回避选择", "让价值观与行动站在同一边，关系才会真实。", "先看清分歧，不要用表面的和谐掩盖真实需要。", "Lovers"],
    ["07", "VII", "战车", "The Chariot", "方向 · 驾驭 · 前行", "失控 · 阻滞 · 方向不明", "力量来自对方向的承诺，而不是一直加速。", "先停下来重新握住缰绳；速度无法替代方向。", "Chariot"],
    ["08", "VIII", "力量", "Strength", "柔韧 · 勇气 · 自持", "自疑 · 压抑 · 消耗", "稳定的力量不必高声，它知道何时收紧、何时放松。", "别把坚持变成惩罚，承认疲惫也是重获力量。", "Strength"],
    ["09", "IX", "隐者", "The Hermit", "独处 · 寻索 · 内在之光", "隔绝 · 逃避 · 过度内省", "离开喧闹不是退缩，而是重新辨认自己的光。", "独处若只剩封闭，就该允许他人的光进入。", "Hermit"],
    ["10", "X", "命运之轮", "Wheel of Fortune", "周期 · 转机 · 变化", "反复 · 抗拒 · 时机未至", "你无法固定轮盘，但可以决定变化来到时如何站稳。", "旧模式正在重复；看见循环，才有机会改变回应。", "Wheel of Fortune"],
    ["11", "XI", "正义", "Justice", "公平 · 事实 · 承担", "偏见 · 逃避 · 不诚实", "回到事实与因果，为自己的选择承担清楚责任。", "某些事实被忽略，先停止辩护再重新衡量。", "Justice"],
    ["12", "XII", "倒吊人", "The Hanged Man", "暂停 · 让渡 · 新视角", "拖延 · 抵抗 · 徒劳牺牲", "主动暂停会打开另一种看法，不必急于推进。", "停滞已不再带来洞见，需要结束无意义的等待。", "Hanged Man"],
    ["13", "XIII", "死神", "Death", "结束 · 转化 · 释放", "抗拒 · 停滞 · 害怕改变", "允许一个阶段结束，空出来的位置才会容纳新的东西。", "紧抓旧状态只会延长消耗，先承认已经发生的变化。", "Death"],
    ["14", "XIV", "节制", "Temperance", "平衡 · 调和 · 节奏", "过量 · 失衡 · 急躁", "用耐心调配不同力量，稳定比猛烈更有效。", "节奏已经失衡，减少过量投入并恢复边界。", "Temperance"],
    ["15", "XV", "恶魔", "The Devil", "依附 · 欲望 · 阴影", "松绑 · 看清 · 收回自主", "看见束缚如何运作，才能诚实面对欲望与代价。", "你正看见锁链并非不可解，主动权正在回来。", "Devil"],
    ["16", "XVI", "高塔", "The Tower", "突变 · 揭露 · 重建", "回避冲击 · 延迟崩解 · 内在动荡", "不稳固的结构正在暴露，真相会为重建腾出空间。", "变化被延迟但没有消失，越早处理裂缝代价越小。", "Tower"],
    ["17", "XVII", "星星", "The Star", "希望 · 澄明 · 修复", "失望 · 疏离 · 信念摇摆", "希望不是保证结果，而是在不确定中仍照料下一步。", "不必强迫乐观，先找到一件仍值得相信的小事。", "Star"],
    ["18", "XVIII", "月亮", "The Moon", "潜意识 · 暧昧 · 梦境", "迷雾渐散 · 焦虑 · 误读", "信息尚不完整，允许模糊存在比仓促结论更诚实。", "用事实检查恐惧；迷雾正在变薄，不必被想象牵走。", "Moon"],
    ["19", "XIX", "太阳", "The Sun", "清晰 · 活力 · 确认", "迟来的喜悦 · 过度乐观 · 疲惫", "让已经清楚的事保持简单，坦率会带来新能量。", "光仍在但被云遮住，给恢复与现实校准留出时间。", "Sun"],
    ["20", "XX", "审判", "Judgement", "觉醒 · 回应 · 复盘", "自我怀疑 · 拒绝召唤 · 苛责", "回看过去不是为了惩罚，而是决定如何回应此刻的召唤。", "别让羞耻替代反思，先给自己一次诚实回答的机会。", "Judgement"],
    ["21", "XXI", "世界", "The World", "完成 · 整合 · 抵达", "未竟 · 延迟 · 缺少收尾", "一个阶段正在闭合，承认完成才能迎接新的开始。", "最后一小步仍需亲自完成，别因接近终点而停下。", "World"],
  ];

  const SUITS = [
    {
      code: "wands",
      filePrefix: "Wands",
      name: "权杖",
      en: "Wands",
      theme: "行动、热情与创造力",
      upright: "让能量找到明确出口，以行动验证想法",
      reversed: "能量可能过热或受阻，先调整方向与节奏",
      keywords: "行动 · 创造 · 意志",
    },
    {
      code: "cups",
      filePrefix: "Cups",
      name: "圣杯",
      en: "Cups",
      theme: "感受、关系与直觉",
      upright: "允许感受流动，并用诚实连接自己与他人",
      reversed: "情绪可能被压抑或泛滥，需要恢复真实边界",
      keywords: "感受 · 关系 · 直觉",
    },
    {
      code: "swords",
      filePrefix: "Swords",
      name: "宝剑",
      en: "Swords",
      theme: "思考、沟通与冲突",
      upright: "让事实与清晰表达切开混乱，做出有意识的判断",
      reversed: "思绪或沟通正在打结，避免被恐惧和假设带走",
      keywords: "思考 · 真相 · 决断",
    },
    {
      code: "pentacles",
      filePrefix: "Pents",
      name: "星币",
      en: "Pentacles",
      theme: "身体、资源与现实成果",
      upright: "把注意力放回可积累的现实行动与长期价值",
      reversed: "资源分配或现实基础不稳，需要重新评估投入",
      keywords: "资源 · 身体 · 实践",
    },
  ];

  const RANKS = [
    [1, "Ace", "王牌", "潜能 · 开端 · 机会", "受阻 · 延迟 · 能量未成形", "新的入口已经出现，适合从最小可行的一步开始", "机会仍在，但条件尚未成熟或注意力过于分散"],
    [2, "Two", "二", "平衡 · 选择 · 对照", "犹疑 · 失衡 · 信息不足", "两个方向需要被同时看见，再做有意识的选择", "迟迟不选本身也在消耗资源，需要补齐关键信息"],
    [3, "Three", "三", "生长 · 协作 · 初步成果", "摩擦 · 分散 · 配合失调", "事物开始成形，借助协作能把可能性推向现实", "角色和预期没有对齐，先澄清合作方式"],
    [4, "Four", "四", "稳定 · 边界 · 暂停", "僵滞 · 不安 · 过度防守", "守住已有成果，并为恢复与整理留出空间", "稳定正在变成封闭，需要允许适度流动"],
    [5, "Five", "五", "变化 · 摩擦 · 缺口", "余波 · 修复 · 冲突内化", "正视眼前的不适与损失，它指出真正需要调整的地方", "冲突表面减弱但仍有余波，修复不能只停在回避"],
    [6, "Six", "六", "过渡 · 支持 · 重新平衡", "延迟 · 失衡 · 旧事牵制", "局面开始移动，接受帮助并带着经验继续前行", "过渡被旧模式拖住，需要重新分配给予与接受"],
    [7, "Seven", "七", "评估 · 坚持 · 多种可能", "混乱 · 自疑 · 选项过载", "在选择与压力中守住真正重要的立场", "可能性太多反而模糊重点，先缩小判断范围"],
    [8, "Eight", "八", "推进 · 训练 · 边界", "受限 · 停滞 · 重复消耗", "持续练习与明确边界会让进展加速", "看似无法移动的限制中，有一部分来自既有认知"],
    [9, "Nine", "九", "成熟 · 韧性 · 接近完成", "透支 · 不满 · 防御过度", "你已走到能独立承担结果的位置，继续守住最后阶段", "长期紧绷正在消耗成果，需要休息并重估期待"],
    [10, "Ten", "十", "完成 · 累积 · 责任", "负荷 · 断裂 · 需要释放", "一个周期的结果已经集中出现，适合整理收获与责任", "累积已经超过承载范围，放下一部分才有空间继续"],
    [11, "Page", "侍从", "消息 · 好奇 · 学习", "幼稚 · 分心 · 表达不清", "以初学者心态接收新信息，先试验再形成结论", "热情缺少持续性，先确认信息与承诺是否可靠"],
    [12, "Knight", "骑士", "追求 · 行动 · 推进", "冲动 · 偏执 · 动能失控", "明确目标后投入行动，让意图获得速度", "行动压过了判断，需要减速检查代价与方向"],
    [13, "Queen", "王后", "内在掌握 · 滋养 · 成熟", "不安 · 过度照料 · 内耗", "相信内在经验，以稳定而有边界的方式回应局面", "照顾与控制混在一起，需要先把能量收回自己"],
    [14, "King", "国王", "担当 · 掌控 · 长期判断", "僵化 · 滥用权力 · 固执", "用成熟判断组织资源，并为长期结果承担责任", "权威正在变成控制，重新听取反馈与现实证据"],
  ];

  const majorCards = MAJOR.map((entry) => {
    const [number, roman, name, en, uprightKeywords, reversedKeywords, uprightText, reversedText, fileName] = entry;
    return {
      id: `major-${number}`,
      arcana: "major",
      suit: null,
      number: Number(number),
      roman,
      name,
      en,
      imageFile: `RWS Tarot ${number} ${fileName}.jpg`,
      meaning: {
        upright: { keywords: uprightKeywords, text: uprightText },
        reversed: { keywords: reversedKeywords, text: reversedText },
      },
    };
  });

  const minorCards = SUITS.flatMap((suit) =>
    RANKS.map((rank) => {
      const [number, rankEn, rankName, uprightKeywords, reversedKeywords, uprightText, reversedText] = rank;
      const padded = String(number).padStart(2, "0");
      return {
        id: `${suit.code}-${padded}`,
        arcana: "minor",
        suit: suit.code,
        number,
        roman: padded,
        name: `${suit.name}${rankName}`,
        en: `${rankEn} of ${suit.en}`,
        imageFile: `${suit.filePrefix}${padded}.jpg`,
        meaning: {
          upright: {
            keywords: `${uprightKeywords} · ${suit.keywords}`,
            text: `${uprightText}。在${suit.theme}上，${suit.upright}。`,
          },
          reversed: {
            keywords: `${reversedKeywords} · ${suit.keywords}`,
            text: `${reversedText}。在${suit.theme}上，${suit.reversed}。`,
          },
        },
      };
    }),
  );

  const config = {
    optimizedLocalBase: "./assets/cards-webp",
    optimizedLocalExtension: "webp",
    localBase: "./assets/cards",
    localExtension: "jpg",
    remoteWidth: 960,
    commonsCategory: COMMONS_CATEGORY,
  };

  function remoteImageUrl(card) {
    const title = encodeURIComponent(card.imageFile);
    return `https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/${title}&width=${config.remoteWidth}`;
  }

  function localImageUrl(card) {
    return `${config.localBase}/${card.id}.${config.localExtension}`;
  }

  function optimizedLocalImageUrl(card) {
    return `${config.optimizedLocalBase}/${card.id}.${config.optimizedLocalExtension}`;
  }

  function imageCandidates(card, mode = "url") {
    const optimizedLocal = optimizedLocalImageUrl(card);
    const local = localImageUrl(card);
    const remote = remoteImageUrl(card);
    if (mode === "local") return [optimizedLocal, local];
    if (mode === "url") return [remote];
    return [optimizedLocal, local, remote];
  }

  window.TarotDeck = Object.freeze({
    cards: Object.freeze([...majorCards, ...minorCards]),
    config,
    imageCandidates,
    optimizedLocalImageUrl,
    localImageUrl,
    remoteImageUrl,
  });
})();
