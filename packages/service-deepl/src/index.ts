import {
  Language,
  Translator,
  TranslateQueryResult
} from "@opentranslate/translator";
import { AxiosPromise } from "axios";
import qs from "qs";

const langMap: [Language, string][] = [
  ["auto", "auto"],
  ["zh-CN", "ZH"],
  ["zh-TW", "ZH"],
  ["de", "DE"],
  ["en", "EN"],
  ["es", "ES"],
  ["fr", "FR"],
  ["it", "IT"],
  ["ja", "JA"],
  ["pt", "PT"],
  ["ru", "RU"]
];

type splitParams = {
  texts: string[];
  lang: {
    lang_user_selected?: string;
    user_preferred_langs: string[];
    source_lang_computed?: string;
    target_lang?: string;
  };
};

type job = {
  kind: string;
  raw_en_sentence: string;
  raw_en_context_before: string[];
  raw_en_context_after: string[];
  preferred_num_beams: number;
};

type translationPrams = {
  jobs: job[];
  priority: number;
  timestamp: number;
};

type Params = {
  id: number;
  jsonrpc: string;
  params: splitParams | translationPrams;
};

type DeepLSplitResult = {
  lang: string;
  lang_is_confident: number;
  splitted_texts: string[];
};

type beam = {
  num_symbols: number;
  postprocessed_sentence: string;
  score: number;
  totalLogProb: number;
};

type translation = {
  beams: beam[];
};

type DeepLTranslateResult = {
  date: string;
  source_lang: string;
  source_lang_is_confident: number;
  target_lang: string;
  timestamp: number;
  translations: translation[];
};

type DeepLErrorRes = {
  jsonrpc: string;
  error: {
    code: number;
    message: string;
  };
};

type DeepLResponse =
  | {
      id: number;
      jsonrpc: string;
      result: DeepLSplitResult | DeepLTranslateResult;
    }
  | DeepLErrorRes;

export interface DeeplConfig {
  LMTBID?: string;
  jsonrpc: string; // 2.0
}

export class Deepl extends Translator<DeeplConfig> {
  /** Translator lang to custom lang */
  private static readonly langMap = new Map(langMap);

  /** Custom lang to translator lang */
  private static readonly langMapReverse = new Map(
    langMap.map(([translatorLang, lang]) => [lang, translatorLang])
  );

  private static host = `https://www2.deepl.com/jsonrpc`;

  private static getId(): number {
    return 1e4 * Math.round(1e4 * Math.random());
  }

  private splitRequest({
    id,
    jsonrpc,
    params
  }: Params): AxiosPromise<DeepLResponse> {
    console.log(id, jsonrpc, params);
    return this.request<DeepLResponse>(Deepl.host, {
      headers: {
        "content-type": "text/plain",
        Cookie:
          "LMTBID=58c81157-360a-47f5-bdfb-40809d9645e9|d2551197821fc62516f3164c867a96f1",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36",
        Origin: "https://www.deepl.com",
        Referer: "https://www.deepl.com/translator",
        "sec-fetch-site": "same-site",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        authority: "www2.deepl.com",
        dnt: 1
      },
      method: "POST",
      data: JSON.stringify({
        jsonrpc: jsonrpc,
        id,
        method: "LMT_split_into_sentences",
        params
      })
    });
  }

  private translateRequest({
    id,
    jsonrpc,
    params
  }: Params): AxiosPromise<DeepLResponse> {
    console.log(id, jsonrpc, params);
    return this.request<DeepLResponse>(Deepl.host, {
      headers: {
        "content-type": "text/plain"
      },
      method: "POST",
      data: JSON.stringify({
        jsonrpc,
        id,
        method: "LMT_handle_jobs",
        params
      })
    });
  }

  protected async query(
    text: string,
    from: Language,
    to: Language,
    config: DeeplConfig
  ): Promise<TranslateQueryResult> {
    // 分词和判断源语言
    let id = Deepl.getId();
    const { data: splitData } = await this.splitRequest({
      id,
      jsonrpc: config.jsonrpc || "2.0",
      params: {
        texts: [text],
        lang: {
          // eslint-disable-next-line @typescript-eslint/camelcase
          lang_user_selected: Deepl.langMap.get(from),
          // eslint-disable-next-line @typescript-eslint/camelcase
          user_preferred_langs: ["ZH", "EN"] // 貌似没有什么作用
        }
      }
    });

    let fromLang = from;
    const toLang = to;

    let jobs: job[] = [
      {
        kind: "default",
        // eslint-disable-next-line @typescript-eslint/camelcase
        raw_en_sentence: text,
        // eslint-disable-next-line @typescript-eslint/camelcase
        raw_en_context_before: [],
        // eslint-disable-next-line @typescript-eslint/camelcase
        raw_en_context_after: [],
        // eslint-disable-next-line @typescript-eslint/camelcase
        preferred_num_beams: 4
      }
    ];

    if ("error" in splitData) {
      throw new Error("API_SERVER_ERROR");
    } else if ("lang" in splitData.result) {
      // eslint-disable-next-line @typescript-eslint/camelcase
      const { lang, splitted_texts } = splitData.result;
      fromLang = Deepl.langMapReverse.get(lang) || from;
      // eslint-disable-next-line @typescript-eslint/camelcase
      jobs = splitted_texts.reduce(
        (pre, value, inx, arr) => {
          return [
            ...pre,
            {
              kind: "default",
              // eslint-disable-next-line @typescript-eslint/camelcase
              raw_en_sentence: value,
              // eslint-disable-next-line @typescript-eslint/camelcase
              raw_en_context_before: arr.slice(0, inx),
              // eslint-disable-next-line @typescript-eslint/camelcase
              raw_en_context_after: arr.slice(inx + 1),
              // eslint-disable-next-line @typescript-eslint/camelcase
              preferred_num_beams: arr.length > 1 ? 1 : 4
            }
          ];
        },
        [] as job[]
      );
    }

    // 翻译
    const { data: transData } = await this.translateRequest({
      id: ++id,
      jsonrpc: config.jsonrpc || "2.0",
      params: {
        jobs,
        lang: {
          // eslint-disable-next-line @typescript-eslint/camelcase
          user_preferred_langs: ["ZH", "EN"],
          // eslint-disable-next-line @typescript-eslint/camelcase
          source_lang_computed: Deepl.langMap.get(fromLang),
          // eslint-disable-next-line @typescript-eslint/camelcase
          target_lang: Deepl.langMap.get(toLang)
        },
        priority: 1,
        timestamp: Date.now().valueOf()
      }
    });

    let translations: string[] = [];

    if ("error" in transData) {
      throw new Error("API_SERVER_ERROR");
    } else if ("translations" in transData.result) {
      const { translations: trans } = transData.result;
      if (trans.length > 1) {
        translations = [
          trans.reduce(
            (pre, value) => pre + value.beams[0].postprocessed_sentence,
            ""
          )
        ];
      } else {
        translations = trans[0].beams.map(e => e.postprocessed_sentence);
      }
    }

    return {
      text: text,
      from: fromLang,
      to: toLang,
      origin: {
        paragraphs: text.split(/\n+/),
        tts: (await this.textToSpeech(text, fromLang)) || undefined
      },
      trans: {
        paragraphs: translations,
        tts: (await this.textToSpeech(translations.join(), toLang)) || undefined
      }
    };
  }

  readonly name = "deepl";

  getSupportLanguages(): Language[] {
    return [...Deepl.langMap.keys()];
  }

  // async detect(text: string): Promise<Language> {
  // }

  async textToSpeech(text: string, lang: Language): Promise<string> {
    return `http://tts.baidu.com/text2audio?${qs.stringify({
      lan: Deepl.langMap.get(lang !== "auto" ? lang : "zh-CN") || "zh",
      ie: "UTF-8",
      spd: 5,
      text
    })}`;
  }
}

export default Deepl;
