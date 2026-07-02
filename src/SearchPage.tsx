import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppContext } from './AppContext';

const resolvePrice = (p: any) => {
  if (typeof p === 'number') return p;
  if (p && typeof p === 'object' && p.amount !== undefined) return p.amount / (p.divisor || 100);
  if (typeof p === 'string') return parseFloat(p) || 0;
  return 0;
};

interface SearchPageProps {
  keyword: string;
  onListingClick: (listingId: string) => void;
  onShopClick: (shopId: string) => void;
}

const SearchPage = ({ keyword, onListingClick, onShopClick }: SearchPageProps) => {
  const [searchData, setSearchData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>('default');

  const { toggleFollow, HeartIcon, token } = useAppContext();

  const fetchData = useCallback(async (query: string, isLoadMore = false, forceRefresh = false, offset = 0) => {
    isLoadMore ? setLoadingMore(true) : setLoading(true);
    setError(null);

    try {
      const res = await fetch(`https://api.podsy.pro/search/${encodeURIComponent(query)}?offset=${offset}&force_refresh=${forceRefresh}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();

      if (json.ERROR) {
        throw new Error(JSON.stringify(json.ERROR, null, 2));
      }

      if (isLoadMore) {
        setSearchData((prev: any) => ({
          ...prev,
          listings: [...(prev?.listings || []), ...(json.listings || [])],
          offset: offset,
        }));
      } else {
        setSearchData(json);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (keyword) {
      fetchData(keyword, false, false);
    }
  }, [keyword, fetchData]); // fetchData artık stabil olduğu için eklenebilir.

  const sortedListings = useMemo(() => {
    if (!searchData?.listings) return [];
    const list = [...searchData.listings];

    if (sortBy === 'favorites') return list.sort((a: any, b: any) => (b.favorites || 0) - (a.favorites || 0));
    if (sortBy === 'views') return list.sort((a: any, b: any) => (b.views || 0) - (a.views || 0));
    if (sortBy === 'price_asc') return list.sort((a: any, b: any) => resolvePrice(a.price) - resolvePrice(b.price));
    if (sortBy === 'price_desc') return list.sort((a: any, b: any) => resolvePrice(b.price) - resolvePrice(a.price));
    
    return list;
  }, [searchData?.listings, sortBy]);

  const handleKeywordFollow = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFollow('keyword', searchData.keyword).then(newStatus => {
      if (newStatus !== undefined) {
        setSearchData((prev: any) => ({ ...prev, is_tracked: newStatus }));
      }
    });
  };

  if (loading) return <div className="flex flex-col items-center justify-center h-[50vh] space-y-4 animate-pulse"><div className="w-16 h-16 border-4 border-sky-500/30 border-t-sky-500 rounded-full animate-spin"></div><p className="text-sky-500 font-mono text-xs uppercase tracking-[0.3em]">Searching...</p></div>;
  if (error) return <div className="text-red-500 text-center mt-20">Error: {error}</div>;
  if (!searchData) return <div className="text-zinc-500 text-center mt-20">No search results found.</div>;

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-[fadeIn_0.3s] pb-20">
      <div className="flex items-end justify-between border-b border-[#333] pb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <p className="text-sky-500 font-black text-[10px] uppercase tracking-widest">Target Keyword</p>
            <div className="cursor-pointer" onClick={handleKeywordFollow} title="Save Search"><HeartIcon isTracked={searchData.is_tracked} /></div>
            <button onClick={() => fetchData(keyword, false, true)} className="text-zinc-500 hover:text-sky-400 transition cursor-pointer ml-2" title="Veriyi Yeniden Çek">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
            </button>
          </div>
          <h2 className="text-4xl font-black tracking-tighter text-white">"{searchData.keyword}"</h2>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="text-right">
            <p className="text-zinc-500 font-bold text-[10px] uppercase tracking-widest mb-1">Total Active Listings</p>
            <p className="text-2xl font-mono font-black text-emerald-400">{searchData.total_count?.toLocaleString()}</p>
          </div>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="bg-[#1a1a1a] border border-[#333] text-zinc-300 text-[11px] font-bold rounded-lg px-3 py-2 outline-none focus:border-sky-500 cursor-pointer uppercase tracking-wider">
            <option value="default">SIRALAMA: Alaka Düzeyi</option>
            <option value="favorites">SIRALAMA: En Çok Favori</option>
            <option value="views">SIRALAMA: En Çok İzlenen</option>
            <option value="price_asc">SIRALAMA: En Düşük Fiyat</option>
            <option value="price_desc">SIRALAMA: En Yüksek Fiyat</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {sortedListings.map((item: any, i: number) => (
          <div key={i} className="bg-[#111] rounded-2xl border border-[#333] overflow-hidden hover:border-sky-500 transition group flex flex-col shadow-lg cursor-pointer relative" onClick={() => onListingClick(item.listing_id)}>
            <div className="absolute top-2 left-2 z-10" title="Takibe Al" onClick={(e) => toggleFollow('listing', item.listing_id, e)}>
              <HeartIcon isTracked={item.is_tracked} />
            </div>
            <div className="relative aspect-square overflow-hidden bg-[#000]">
              <img src={item.image_url} alt={item.title} className="w-full h-full object-cover group-hover:scale-110 transition duration-500 opacity-90 group-hover:opacity-100" />
              <div className="absolute top-2 right-2 bg-black/80 backdrop-blur-md px-2 py-1 rounded text-[10px] font-mono font-bold text-sky-400 border border-[#333]">{resolvePrice(item.price).toFixed(2)} {item.currency || 'USD'}</div>
            </div>
            <div className="p-4 flex flex-col flex-1 space-y-3">
              <h3 className="text-zinc-300 text-xs font-bold line-clamp-2 leading-snug group-hover:text-sky-400 transition">{item.title}</h3>
              <div className="mt-auto pt-3 flex items-center justify-between border-t border-[#222]">
                <span className="text-[10px] font-bold text-zinc-500 truncate max-w-[60%] hover:text-white" onClick={(e) => { e.stopPropagation(); onShopClick(item.shop_name); }}>
                  {item.shop_name || " "}
                </span>
                <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-bold">
                  <span>👁 {item.views}</span><span className="text-rose-500">❤️ {item.favorites}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {searchData.listings && searchData.listings.length < searchData.total_count && (
        <div className="flex justify-center mt-12 mb-8">
          <button onClick={() => fetchData(keyword, true, false, (searchData?.offset || 0) + 100)} disabled={loadingMore} className={`bg-[#111] border border-[#333] text-sky-500 font-black px-12 py-4 rounded-xl hover:bg-sky-900/20 hover:border-sky-500 transition shadow-lg shadow-sky-900/10 tracking-[0.2em] text-xs uppercase flex items-center gap-3 ${loadingMore ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}>
            {loadingMore ? 'YÜKLENİYOR...' : 'DAHA FAZLA YÜKLE'}
          </button>
        </div>
      )}
    </div>
  );
};

export default SearchPage;