export const TEXT_PREVIEW_SAMPLE_KEY = 'font-butler-text-preview-sample'
export const TEXT_PREVIEW_LANGUAGE_KEY = 'font-butler-text-preview-language'
export const DEFAULT_TEXT_PREVIEW_LANGUAGE = 'en'

export type TextPreviewLanguage = {
  id: string
  label: string
  /** BCP 47 tag for the sample field. */
  lang: string
  text: string
}

/**
 * Established pangrams (type specimens), not translated sentences.
 * English stays first; the rest are alphabetical by English name.
 */
const OTHER_TEXT_PREVIEW_LANGUAGES: TextPreviewLanguage[] = [
  {
    id: 'ar',
    label: 'Arabic',
    lang: 'ar',
    text: 'نص حكيم له سر قاطع وذو شأن عظيم مكتوب على ثوب أخضر ومغلف بجلد أزرق',
  },
  {
    id: 'hy',
    label: 'Armenian',
    lang: 'hy',
    text: 'Չին ֆիզիկոսը օճառաջուր ցողելով բժշկում է հայ գնդապետի փքված ձախ թևը։',
  },
  {
    id: 'az',
    label: 'Azerbaijani',
    lang: 'az',
    text: 'Zəfər, jaketini də papağını da götür, bu axşam hava çox soyuq olacaq.',
  },
  {
    id: 'be',
    label: 'Belarusian',
    lang: 'be',
    text: 'У Іўі худы жвавы чорт у зялёнай камізэльцы пабег пад’есці фаршу з юшкай.',
  },
  {
    id: 'bn',
    label: 'Bengali',
    lang: 'bn',
    text: 'ঊনিশে কার্তিক রাত্র সাড়ে আট ঘটিকায় ভৈরবনিবাসী ব্যাংকের ক্ষুদ্র ঋণগ্রস্ত অভাবী দুঃস্থ প্রৌঢ় কৃষক এজাজ মিঞা হাতের কাছে ঔষধ থাকিতেও ঐ ঋণের ডরেই চোখে ঝাপসা দেখিয়া বুকের যন্ত্রণায় ঈষৎ কাঁপিয়া উঠিয়া উঠানে বিছানো ধূসর রঙের ফরাশের উপর ঢলিয়া পড়িলেন।',
  },
  {
    id: 'bg',
    label: 'Bulgarian',
    lang: 'bg',
    text: 'Я, пазачът Вальо уж бди, а скришом хапва кюфтенца зад щайгите!',
  },
  {
    id: 'my',
    label: 'Burmese',
    lang: 'my',
    text: 'သီဟိုဠ်မှ ဉာဏ်ကြီးရှင်သည် အာယုဝဍ္ဎနဆေးညွှန်းစာကို ဇလွန်ဈေးဘေးဗာဒံပင်ထက် အဓိဋ္ဌာန်လျက် ဂဃနဏဖတ်ခဲ့သည်။',
  },
  {
    id: 'ca',
    label: 'Catalan',
    lang: 'ca',
    text: '«Dóna amor que seràs feliç!». Això, il·lús company geniüt, ja és un lluït rètol blavís d’onze kWh.',
  },
  {
    id: 'chr',
    label: 'Cherokee',
    lang: 'chr',
    text: 'ᎠᏍᎦᏯᎡᎦᎢᎾᎨᎢᎣᏍᏓᎤᎩᏍᏗᎥᎴᏓᎯᎲᎢᏔᎵᏕᎦᏟᏗᏖᎸᎳᏗᏗᎧᎵᎢᏘᎴᎩ ᏙᏱᏗᏜᏫᏗᏣᏚᎦᏫᏛᏄᏓᎦᏝᏃᎠᎾᏗᎭᏞᎦᎯᎦᏘᏓᏠᎨᏏᏕᏡᎬᏢᏓᏥᏩᏝᎡᎢᎪᎢ ᎠᎦᏂᏗᎮᎢᎫᎩᎬᏩᎴᎢᎠᏆᏅᏛᎫᏊᎾᎥᎠᏁᏙᎲᏐᏈᎵᎤᎩᎸᏓᏭᎷᏤᎢᏏᏉᏯᏌᏊ ᎤᏂᏋᎢᏡᎬᎢᎰᏩᎬᏤᎵᏍᏗᏱᎩᎱᎱᎤᎩᎴᎢᏦᎢᎠᏂᏧᏣᏨᎦᏥᎪᎥᏌᏊᎤᎶᏒᎢᎢᏡᎬᎢ ᎹᎦᎺᎵᏥᎻᎼᏏᎽᏗᏩᏂᎦᏘᎾᎿᎠᏁᎬᎢᏅᎩᎾᏂᎡᎢᏌᎶᎵᏎᎷᎠᏑᏍᏗᏪᎩ ᎠᎴ ᏬᏗᏲᏭᎾᏓᏍᏓᏴᏁᎢᎤᎦᏅᏮᏰᎵᏳᏂᎨᎢ.',
  },
  {
    id: 'hr',
    label: 'Croatian',
    lang: 'hr',
    text: 'Gojazni đačić s biciklom drži hmelj i finu vatu u džepu nošnje.',
  },
  {
    id: 'cs',
    label: 'Czech',
    lang: 'cs',
    text: 'Nechť již hříšné saxofony ďáblů rozezvučí síň úděsnými tóny waltzu, tanga a quickstepu.',
  },
  {
    id: 'da',
    label: 'Danish',
    lang: 'da',
    text: 'Quizdeltagerne spiste jordbær med fløde, mens cirkusklovnen Walther spillede på xylofon.',
  },
  {
    id: 'nl',
    label: 'Dutch',
    lang: 'nl',
    text: 'Pa’s wijze lynx bezag vroom het fikse aquaduct.',
  },
  {
    id: 'dz',
    label: 'Dzongkha',
    lang: 'dz',
    text: 'ཨ་ཡིག་དཀར་མཛེས་ལས་འཁྲུངས་ཤེས་བློའི་གཏེར༎ ཕས་རྒོལ་ཝ་སྐྱེས་ཟིལ་གནོན་གདོང་ལྔ་བཞིན༎ ཆགས་ཐོགས་ཀུན་བྲལ་མཚུངས་མེད་འཇམ་དབྱངསམཐུས༎ མཧཱ་མཁས་པའི་གཙོ་བོ་ཉིད་འགྱུར་ཅིག།',
  },
  {
    id: 'eo',
    label: 'Esperanto',
    lang: 'eo',
    text: 'Laŭ Ludoviko Zamenhof bongustas freŝa ĉeĥa manĝaĵo kun spicoj.',
  },
  {
    id: 'et',
    label: 'Estonian',
    lang: 'et',
    text: 'Põdur Zagrebi tšellomängija-följetonist Ciqo külmetas kehvas garaažis.',
  },
  {
    id: 'ee',
    label: 'Ewe',
    lang: 'ee',
    text: 'Dzigbe zã nyuie na wò, ɣeyiɣi didi aɖee nye sia no see, ɣeyiɣi aɖee nye sia tso esime míeyi suku. Ŋdɔ nyui, ɛ nyteƒe, míagakpɔ wò ake wuieve kele ʋ heda kpedeŋu.',
  },
  {
    id: 'fil',
    label: 'Filipino',
    lang: 'fil',
    text: 'Kumusta Roxas, di ba aalis na kayo nina Victoria sa Quezon at pupunta ng Naga? Titingnan niyo ba ang Peñafrancia? Kung gayon huwag niyo na isama si Juan.',
  },
  {
    id: 'fi',
    label: 'Finnish',
    lang: 'fi',
    text: 'Wieniläinen siouxia puhuva ökyzombi diggaa Åsan roquefort-tacoja.',
  },
  {
    id: 'fr',
    label: 'French',
    lang: 'fr',
    text: 'Portez ce vieux whisky au juge blond qui fume.',
  },
  {
    id: 'ka',
    label: 'Georgian',
    lang: 'ka',
    text: 'გვიპყრობდა კვამლი, ჩიტებს გაჰქონდათ ჟღურტული ზეცაში, ძილს უფრთხობს ჭიქების ჯახუნი მიწებში.',
  },
  {
    id: 'de',
    label: 'German',
    lang: 'de',
    text: 'Victor jagt zwölf Boxkämpfer quer über den großen Sylter Deich.',
  },
  {
    id: 'el',
    label: 'Greek',
    lang: 'el',
    text: 'Ξεσκεπάζω την ψυχοφθόρα σας βδελυγμία.',
  },
  {
    id: 'he',
    label: 'Hebrew',
    lang: 'he',
    text: 'כך התרסק נפץ על גוזל קטן, שדחף את צבי למים.',
  },
  {
    id: 'hi',
    label: 'Hindi',
    lang: 'hi',
    text: 'ऋषियों को सताने वाले दुष्ट राक्षसों के राजा रावण का सर्वनाश करने वाले विष्णुवतार भगवान श्रीराम, अयोध्या के महाराज दशरथ के बड़े सपुत्र थे।',
  },
  {
    id: 'hu',
    label: 'Hungarian',
    lang: 'hu',
    text: 'Egy hűtlen vejét fülöncsípő, dühös mexikói úr Wesselényinél mázol Quitóban.',
  },
  {
    id: 'is',
    label: 'Icelandic',
    lang: 'is',
    text: 'Kæmi ný öxi hér, ykist þjófum nú bæði víl og ádrepa.',
  },
  {
    id: 'ig',
    label: 'Igbo',
    lang: 'ig',
    text: 'Nne, nna, wepụ he’l’ụjọ dum n’ime ọzụzụ ụmụ, vufesi obi nye Chukwu, ṅụrịanụ, gbakọọnụ kpaa, kwee ya ka o guzoshie ike; ọ ghaghị ito, nwapụta ezi agwa.',
  },
  {
    id: 'id',
    label: 'Indonesian',
    lang: 'id',
    text: 'Muharjo seorang xenofobia universal yang takut pada warga jazirah, contohnya Qatar.',
  },
  {
    id: 'ga',
    label: 'Irish',
    lang: 'ga',
    text: 'D’fhuascail Íosa Úrmhac na hÓighe Beannaithe pór Éabha agus Ádhaimh.',
  },
  {
    id: 'it',
    label: 'Italian',
    lang: 'it',
    text: 'Pranzo d’acqua fa volti sghembi.',
  },
  {
    id: 'ja',
    label: 'Japanese',
    lang: 'ja',
    text: 'いろはにほへと ちりぬるを わかよたれそ つねならむ うゐのおくやま けふこえて あさきゆめみし ゑひもせすん',
  },
  {
    id: 'jv',
    label: 'Javanese',
    lang: 'jv',
    text: '꧋ ꦲꦤꦕꦫꦏ꧈ ꦢꦠꦱꦮꦭ꧈ ꦥꦝꦗꦪꦚ꧈ ꦩꦒꦧꦛꦔ꧉',
  },
  {
    id: 'ko',
    label: 'Korean',
    lang: 'ko',
    text: '키스의 고유 조건은 입술끼리 만나야 하고 특별한 기술은 필요치 않다.',
  },
  {
    id: 'ku',
    label: 'Kurdish',
    lang: 'ku',
    text: 'Cem vî Feqoyê pîs zêdetir ji çar gulên xweşik hebûn.',
  },
  {
    id: 'la',
    label: 'Latin',
    lang: 'la',
    text: 'Sic fugiens, dux, zelotypos, quam Karus haberis.',
  },
  {
    id: 'lv',
    label: 'Latvian',
    lang: 'lv',
    text: 'Glāžšķūņa rūķīši dzērumā čiepj Baha koncertflīģeļu vākus.',
  },
  {
    id: 'lt',
    label: 'Lithuanian',
    lang: 'lt',
    text: 'Įlinkdama fechtuotojo špaga sublykčiojusi pragręžė apvalų arbūzą.',
  },
  {
    id: 'mk',
    label: 'Macedonian',
    lang: 'mk',
    text: 'Ѕидарски пејзаж: шугав билмез со чудење џвака ќофте и кељ на туѓ цех.',
  },
  {
    id: 'ms',
    label: 'Malay',
    lang: 'ms',
    text: 'Muzafar kerap sembahyang dan baca al-Quran waktu belajar di Universiti Oxford.',
  },
  {
    id: 'ml',
    label: 'Malayalam',
    lang: 'ml',
    text: 'അജവും ആനയും ഐരാവതവും ഗരുഡനും കഠോര സ്വരം പൊഴിക്കെ ഹാരവും ഒഢ്യാണവും ഫാലത്തില്‍ മഞ്ഞളും ഈറന്‍ കേശത്തില്‍ ഔഷധ എണ്ണയുമായി ഋതുമതിയും അനഘയും ഭൂനാഥയുമായ ഉമ ദുഃഖഛവിയോടെ ഇടതു പാദം ഏന്തി ങ്യേയാദൃശം നിര്‍ഝരിയിലെ ചിറ്റലകളെ ഓമനിക്കുമ്പോള്‍ ബാ‍ലയുടെ കണ്‍കളില്‍ നീര്‍ ഊര്‍ന്നു വിങ്ങി.',
  },
  {
    id: 'arn',
    label: 'Mapudungun',
    lang: 'arn',
    text: 'Ngütram minchetu apochiküyeṉ: ñidol che mamüll ka rag kushe ḻafkeṉ mew.',
  },
  {
    id: 'mn',
    label: 'Mongolian',
    lang: 'mn',
    text: 'Щётканы фермд пийшин цувъя. Бөгж зогсч хэльюү.',
  },
  {
    id: 'nb',
    label: 'Norwegian',
    lang: 'nb',
    text: 'Vår sære Zulu fra badeøya spilte jo whist og quickstep i min taxi.',
  },
  {
    id: 'fa',
    label: 'Persian',
    lang: 'fa',
    text: 'بر اثر چنین تلقین و شستشوی مغزی جامعی، سطح و پایهٔ ذهن و فهم و نظر بعضی اشخاص واژگونه و معکوس می‌شود.',
  },
  {
    id: 'pl',
    label: 'Polish',
    lang: 'pl',
    text: 'Pchnąć w tę łódź jeża lub ośm skrzyń fig.',
  },
  {
    id: 'pt',
    label: 'Portuguese',
    lang: 'pt',
    text: 'Vejo galã sexy pôr quinze kiwis à força em baú achatado.',
  },
  {
    id: 'pa',
    label: 'Punjabi',
    lang: 'pa',
    text: 'ڈِٹھے پار پہاڑ حضوری دے، طلسمی ژالہ باری ظلمت دی ۔ فیر جاکے ٹِبے غار حراء دے، خبر دِتتِی چاراں پاسے۔ اک ذہین زور آور نے فقیری دی۔ ہس کے نالے گج وج کے ذمے داری نال دسیا ثمر صبر دا، حاصل عشق دا، جیہڑا ہے کل پیغام',
  },
  {
    id: 'ro',
    label: 'Romanian',
    lang: 'ro',
    text: 'Încă vând gem, whisky bej și tequila roz, preț fix.',
  },
  {
    id: 'ru',
    label: 'Russian',
    lang: 'ru',
    text: 'Съешь ещё этих мягких французских булок, да выпей же чаю.',
  },
  {
    id: 'sa',
    label: 'Sanskrit',
    lang: 'sa',
    text: 'घटाश्च शङ्खाश्च धरन्ति तोयम् । शठादिमूढा न भजन्ति सत्यम् । वराहयूथानि किलन्ति पुच्छैः । गडेषु झञ्झाः सबलं फणन्ते ॥',
  },
  {
    id: 'sr',
    label: 'Serbian',
    lang: 'sr',
    text: 'Љубазни фењерџија чађавог лица хоће да ми покаже штос.',
  },
  {
    id: 'sk',
    label: 'Slovak',
    lang: 'sk',
    text: 'Vypätá dcéra grófa Maxwella s IQ nižším ako kôň núti čeľaď hrýzť hŕbu jabĺk.',
  },
  {
    id: 'sl',
    label: 'Slovenian',
    lang: 'sl',
    text: 'V kožuščku hudobnega fanta stopiclja mizar.',
  },
  {
    id: 'es',
    label: 'Spanish',
    lang: 'es',
    text: 'El veloz murciélago hindú comía feliz cardillo y kiwi. La cigüeña tocaba el saxofón detrás del palenque de paja.',
  },
  {
    id: 'sv',
    label: 'Swedish',
    lang: 'sv',
    text: 'Yxskaftbud, ge vår WC-zonmö IQ-hjälp.',
  },
  {
    id: 'th',
    label: 'Thai',
    lang: 'th',
    text: 'นายสังฆภัณฑ์ เฮงพิทักษ์ฝั่ง ผู้เฒ่าซึ่งมีอาชีพเป็นฅนขายฃวด ถูกตำรวจปฏิบัติการจับฟ้องศาล ฐานลักนาฬิกาคุณหญิงฉัตรชฎา ฌานสมาธิ',
  },
  {
    id: 'tzm',
    label: 'Tamajaq',
    lang: 'tzm',
    text: 'Xa bălla imuzărăn naŋŋin wər gəmmiyăn âr taggaẓt dəɣ Məššina fəl ad agəẓ ṭǝma n ăɣrǝm han măqqăja săkṣoḍnen.',
  },
  {
    id: 'tok',
    label: 'Toki Pona',
    lang: 'tok',
    text: 'jan li pana e moku tawa sina.',
  },
  {
    id: 'tr',
    label: 'Turkish',
    lang: 'tr',
    text: 'Pijamalı hasta yağız şoföre çabucak güvendi.',
  },
  {
    id: 'uk',
    label: 'Ukrainian',
    lang: 'uk',
    text: 'Єхидна, ґава, їжак ще й шиплячі плазуни бігцем форсують Янцзи.',
  },
  {
    id: 'ur',
    label: 'Urdu',
    lang: 'ur',
    text: 'نہ ژالہ باری نہ دھوپ پڑتی نہ ٹمٹماتی ہے چاندنی اب نہ کوئی ساغر نہ آگ برکھا،عجیب طرز فنا چلی اب جدا حلاوت ، خفا ظرافت،ضعیف ہر شوق، ڈر نہ صدمہ ثمر جو ذکر حبیب کا ہے یہ تجھہ کو عرفی ملا سبھی اب',
  },
  {
    id: 'vi',
    label: 'Vietnamese',
    lang: 'vi',
    text: 'Trường quê em do bố của em xây kĩ nên sạch và đẹp lắm.',
  },
  {
    id: 'cy',
    label: 'Welsh',
    lang: 'cy',
    text: 'Ni pharciais fy nghas gar ffabrig pinc a’m jac codi baw hud llawn dŵr chwerw ger tŷ Mabon ar ddydd Mawrth, ond parciais fe mewn lagŵn rhydlyd.',
  },
]

const ENGLISH_TEXT_PREVIEW: TextPreviewLanguage = {
  id: DEFAULT_TEXT_PREVIEW_LANGUAGE,
  label: 'English',
  lang: 'en',
  text: 'The quick brown fox jumps over the lazy dog.',
}

export const DEFAULT_TEXT_PREVIEW = ENGLISH_TEXT_PREVIEW.text

export const TEXT_PREVIEW_LANGUAGES: readonly TextPreviewLanguage[] = [
  ENGLISH_TEXT_PREVIEW,
  ...[...OTHER_TEXT_PREVIEW_LANGUAGES].sort((a, b) => a.label.localeCompare(b.label, 'en')),
]

const TEXT_PREVIEW_BY_ID = new Map(TEXT_PREVIEW_LANGUAGES.map((language) => [language.id, language]))

export function textPreviewLanguage(id: string | null | undefined): TextPreviewLanguage {
  if (!id) return ENGLISH_TEXT_PREVIEW
  return TEXT_PREVIEW_BY_ID.get(id) ?? ENGLISH_TEXT_PREVIEW
}

export function applyTextPreviewLanguage(id: string): { id: string; text: string; lang: string } {
  const language = textPreviewLanguage(id)
  return { id: language.id, text: language.text, lang: language.lang }
}

export function readTextPreviewLanguage(): string {
  try {
    return textPreviewLanguage(localStorage.getItem(TEXT_PREVIEW_LANGUAGE_KEY)).id
  } catch {
    return DEFAULT_TEXT_PREVIEW_LANGUAGE
  }
}

export function readTextPreviewSample(): string {
  try {
    const stored = localStorage.getItem(TEXT_PREVIEW_SAMPLE_KEY)
    if (stored != null) return stored
  } catch {
    return textPreviewLanguage(DEFAULT_TEXT_PREVIEW_LANGUAGE).text
  }
  return textPreviewLanguage(readTextPreviewLanguage()).text
}

/** Rough row count so the full-width text window can scroll before cards are measured. */
export function estimateTextPreviewLines(text: string, previewSize: number): number {
  const size = Number.isFinite(previewSize) && previewSize > 0 ? previewSize : 4
  const wide = /[^\u0000-\u024f]/.test(text)
  const charsPerLine = wide
    ? Math.max(6, Math.round(36 / size))
    : Math.max(12, Math.round(80 / size))
  const lines = Math.ceil(Math.max(text.length, 1) / charsPerLine)
  return Math.min(16, Math.max(1, lines))
}
