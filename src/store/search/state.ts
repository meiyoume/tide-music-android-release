/**
 * 搜索结果的类型
 *
 * 移植版加了 `both`：一次同时搜歌曲与歌单，结果左右并排（左歌曲 / 右歌单）。
 * 上游只有 `music` / `songlist` 二选一。
 */
export type SearchType = 'music' | 'songlist' | 'both'

export interface InitState {
  temp_source: 'kw'
  // temp_source: LX.OnlineSource
  searchType: SearchType
  searchText: string
  tipListInfo: {
    text: string
    source: 'kw'
    list: string[]
  }
  historyList: string[]
}

const state: InitState = {
  temp_source: 'kw',
  searchType: 'music',
  searchText: '',
  tipListInfo: {
    text: '',
    source: 'kw',
    list: [],
  },
  historyList: [],
}


export default state
