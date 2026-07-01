import { useState, useEffect, useCallback } from 'react';
import ListingDetail from './ListingDetail';
import ShopDetail from './ShopDetail';
import SearchPage from './SearchPage';
import ListPage from './ListPage';
import ComparePage from './ComparePage';
import LoginPage from './LoginPage';
import ProfilePage from './ProfilePage';
import UploadProductPage from './UploadProductPage';
import { useAppContext } from './AppContext';

// Görünüm tiplerini ve parametrelerini bir arada tutan bir state yapısı daha yönetilebilir olur.
type ViewState = 
  | { view: 'dashboard' }
  | { view: 'search'; keyword: string }
  | { view: 'listing'; id: string }
  | { view: 'shop'; id: string }
  | { view: 'compare' }
  | { view: 'profile' }
  | { view: 'upload_product'; shop_id: string }
  | { view: 'fav_keywords' | 'fav_listings' | 'fav_shops' }
  | { view: 'history_listings' | 'history_shops' | 'history_keywords' };

const App = () => {
  const { currentUser, logout, favData, historyData, fetchFavorites, fetchHistory, token } = useAppContext();
  // State'leri birleştirerek daha yönetilebilir hale getirelim.
  const [currentView, setCurrentView] = useState<ViewState>({ view: 'dashboard' });
  const [searchQuery, setSearchQuery] = useState('');
  
  // Global yüklenme durumları (sayfa geçişleri için) kalabilir.
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [errorData, setErrorData] = useState<string | null>(null);

  // Bu state'ler kendi sayfalarına taşınacak.
  // const [sortBy, setSortBy] = useState<string>('default');
  // const [searchOffset, setSearchOffset] = useState(0);
  // const [loadingMore, setLoadingMore] = useState(false);

  const navigateTo = useCallback((newViewState: ViewState) => {
    setCurrentView(newViewState);
    // URL'i de yeni state yapısına göre güncelleyelim.
    const params = new URLSearchParams({ view: newViewState.view, ...('id' in newViewState && {id: newViewState.id}), ...('keyword' in newViewState && {keyword: newViewState.keyword}) });
    window.history.pushState(newViewState, '', `?${params.toString()}`);
  }, []);

  const handleBack = useCallback(() => {
    window.history.back();
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    
    // ETSY OAUTH CALLBACK HANDLING
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    if (window.location.pathname.includes('/etsy/callback') && code && state) {
      if (!token) return; // Wait for token to load
      setLoading(true);
      fetch(`https://api.podsy.pro/etsy/callback?code=${code}&state=${state}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(data => {
        alert("Etsy mağazanız başarıyla bağlandı!");
        window.location.href = "/?view=profile";
      })
      .catch(err => {
        alert("Etsy bağlantısı sırasında hata oluştu.");
        window.location.href = "/?view=profile";
      });
      return;
    }

    const initialView = (urlParams.get('view') as any) || 'dashboard';
    const id = urlParams.get('id');
    const keyword = urlParams.get('keyword');

    const initialState: ViewState = { view: initialView };
    if (id) (initialState as any).id = id;
    if (keyword) (initialState as any).keyword = keyword;

    window.history.replaceState(initialState, '', window.location.search);
    setCurrentView(initialState);

    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.view) {
        setCurrentView(event.state);
      } else {
        // Fallback for older browsers or manual URL changes
        setCurrentView({ view: 'dashboard' });
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!document.getElementById('tailwind-cdn')) {
      const script = document.createElement('script');
      script.id = 'tailwind-cdn';
      script.src = 'https://cdn.tailwindcss.com';
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => {
    if (currentView.view.startsWith('fav_')) {
      const type = currentView.view.split('_')[1];
      fetchFavorites(type);
    }
    else if (currentView.view.startsWith('history_')) {
      const type = currentView.view.split('_')[1];
      fetchHistory(type);
    }
  }, [currentView.view, fetchFavorites, fetchHistory]);

  // handleSearch fonksiyonu büyük ölçüde basitleşecek veya tamamen kalkacak.
  // Arama kutusuna yazılanı alıp sadece yönlendirme yapacak.
  const handleSearch = async (query: string) => {
    if (!query) return;

    setLoading(true);
    setErrorData(null);

    let cleanQuery = query.trim();

    try {
      // URL/ID tespiti
      if (cleanQuery.includes('etsy.com/listing/')) {
        const match = cleanQuery.match(/listing\/(\d+)/);
        if (match) { navigateTo({ view: 'listing', id: match[1] }); return; }
      }
      if (cleanQuery.includes('etsy.com/shop/')) {
        const match = cleanQuery.match(/shop\/([^\/\?]+)/);
        if (match) { navigateTo({ view: 'shop', id: match[1] }); return; }
      }
      // Sadece sayısal ID ise, önce listing sonra shop olarak kontrol etmeye gerek yok.
      // Kullanıcıyı direkt ID ile ilgili sayfaya yönlendirelim, o sayfa kendi kontrolünü yapsın.
      if (/^\d+$/.test(cleanQuery)) {
        // Belirsiz ID'ler için yeni bir sayfa oluşturulabilir veya
        // varsayılan olarak listing sayfasına yönlendirilebilir.
        navigateTo({ view: 'listing', id: cleanQuery });
        return;
      }

      // Eğer hiçbiri değilse, bu bir keyword aramasıdır.
      navigateTo({ view: 'search', keyword: cleanQuery });

    } catch (e: any) {
      setErrorData("Bir hata oluştu: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // Bu fonksiyonlar artık gereksiz, çünkü her sayfa kendi verisini çekecek.
  /*
  const executeListingScan = async (listingId: string, forceRefresh = false) => {
    setLoading(true);
    setErrorData(null);
    // ...
    setListingData(formattedData);
    navigateTo({ view: 'listing', id: listingId });
    // ...
    setLoading(false);
  };
  const executeShopScan = async (shopId: string, forceRefresh = false) => {
    setLoading(true);
    setErrorData(null);
    try {
      const res = await fetch(`https://api.podsy.pro/shop/${shopId}?force_refresh=${forceRefresh}`);
      const json = await res.json();
      if(json.ERROR) throw new Error(typeof json.ERROR === 'string' ? json.ERROR : JSON.stringify(json.ERROR));
      setShopData(json);
      navigateTo({ view: 'shop', id: shopId });
    } catch (e: any) { setErrorData(e.message); }
    finally { setLoading(false); }
  };
  */

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      await fetch(`https://api.podsy.pro/sync-all`, { method: 'POST' });
      alert("✅ Arka planda veri eşitleme başlatıldı.");
    } catch (e) { alert("Eşitleme başlatılamadı."); }
    setTimeout(() => setSyncing(false), 2000);
  };

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
  
    const formData = new FormData();
    formData.append('file', file);
  
    setSyncing(true);
    try {
      const res = await fetch('https://api.podsy.pro/import-keywords', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      alert(data.message);
    } catch (err) {
      alert("Yükleme hatası!");
    } finally {
      setSyncing(false);
    }
  }, []);

  // Hangi sayfanın render edileceğini belirleyen fonksiyon
  const CurrentViewComponent = () => {
    switch (currentView.view) {
      case 'dashboard':
        return (
          <div className="max-w-4xl mx-auto mt-20 p-10 border-2 border-dashed border-zinc-800 rounded-3xl text-center">
            <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter">Etsy Keyword Import</h2>
            <p className="text-zinc-500 mb-8 text-sm">Etsy Search Analytics üzerinden indirdiğin Excel dosyasını buraya yükle.<br/>Tüm kelimeler otomatik olarak taranacak ve veritabanına eklenecektir.</p>
            <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} className="hidden" id="excel-upload" />
            <label htmlFor="excel-upload" className="cursor-pointer bg-sky-500 hover:bg-sky-400 text-white px-8 py-4 rounded-2xl font-black uppercase transition-all inline-block">
              {syncing ? 'İŞLENİYOR...' : 'EXCEL DOSYASI SEÇ'}
            </label>
          </div>
        );
      case 'search':
        return <SearchPage 
                  keyword={currentView.keyword}
                  onListingClick={(id) => navigateTo({ view: 'listing', id: id })}
                  onShopClick={(id) => navigateTo({ view: 'shop', id: id })} />;
      case 'listing':
        return <ListingDetail 
                  listingId={currentView.id} 
                  onShopClick={(id) => navigateTo({ view: 'shop', id: id })} 
                  onTagClick={(tag) => navigateTo({ view: 'search', keyword: tag })}
                  onBack={handleBack}
               />;
      case 'shop':
        return <ShopDetail 
                  shopId={currentView.id} 
                  onListingClick={(id) => navigateTo({ view: 'listing', id: id })} 
                  onUploadClick={(id) => navigateTo({ view: 'upload_product', shop_id: id })}
                  onBack={handleBack}
               />;
      case 'upload_product':
        return <UploadProductPage 
                  shopId={currentView.shop_id} 
                  onBack={handleBack}
               />;
      case 'compare':
        return <ComparePage 
                  onListingClick={(id) => navigateTo({ view: 'listing', id: id })} 
                  onShopClick={(id) => navigateTo({ view: 'shop', id: id })} 
               />;
      case 'profile':
        return <ProfilePage onNavigate={(view, id) => {
          if (view === 'shop') {
            navigateTo({ view: 'shop', id });
          }
        }} />;
      case 'fav_listings':
        return <ListPage title="Favorited Listings" items={favData} itemType="listing" onItemClick={(type, id) => navigateTo({ view: type, id: id })} />;
      case 'fav_shops':
        return <ListPage title="Favorited Shops" items={favData} itemType="shop" onItemClick={(type, id) => navigateTo({ view: type, id: id })} />;
      case 'fav_keywords':
        return <ListPage title="Favorited Keywords" items={favData} itemType="keyword" onItemClick={(type, keyword) => navigateTo({ view: type, keyword: keyword })} />;
      case 'history_listings':
        return <ListPage title="Listing History" items={historyData} itemType="listing" onItemClick={(type, id) => navigateTo({ view: type, id: id })} />;
      case 'history_shops':
        return <ListPage title="Shop History" items={historyData} itemType="shop" onItemClick={(type, id) => navigateTo({ view: type, id: id })} />;
      case 'history_keywords':
        return <ListPage title="Keyword History" items={historyData} itemType="keyword" onItemClick={(type, keyword) => navigateTo({ view: type, keyword: keyword })} />;
      default:
        return <div>Page Not Found</div>;
    }
  };

  if (currentUser === undefined) {
    return <div className="min-h-screen bg-[#050505] flex items-center justify-center text-white font-mono">Yükleniyor...</div>;
  }

  if (currentUser === null) {
    return <LoginPage />;
  }

  return (
    <div className="flex min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-sky-500/30">
      {currentUser && (
        <aside className="w-64 bg-[#111] border-r border-[#222] flex flex-col sticky top-0 h-screen shrink-0">
          <div className="p-6 border-b border-[#222] cursor-pointer" onClick={() => navigateTo({ view: 'dashboard' })}>
            <h1 className="text-2xl font-black m-0 tracking-tighter italic text-white hover:text-sky-400 transition">PODSY<span className="text-sky-500">PRO</span></h1>
            <p className="text-[10px] text-zinc-500 font-bold mt-1 uppercase tracking-widest">Intelligence Engine</p>
          </div>
          
          <nav className="flex-1 p-4 space-y-6 overflow-y-auto custom-scrollbar">
            
            <div onClick={() => navigateTo({ view: 'dashboard' })} className={`px-4 py-3 rounded-lg font-bold text-xs cursor-pointer transition-all ${currentView.view === 'dashboard' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20 shadow-lg shadow-sky-900/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a]'}`}>
              DASHBOARD
            </div>

            <div onClick={() => navigateTo({ view: 'profile' })} className={`px-4 py-3 rounded-lg font-bold text-xs cursor-pointer transition-all ${currentView.view === 'profile' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-lg shadow-emerald-900/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a]'}`}>
              PROFIL & MAĞAZALAR
            </div>

          <div className="space-y-2">
            <h3 className="px-4 text-[10px] font-black text-zinc-600 uppercase tracking-widest">Keyword</h3>
            <div onClick={() => currentView.view === 'search' ? navigateTo(currentView) : null} className={`px-4 py-2.5 rounded-lg font-bold text-xs transition-all flex items-center gap-2 ${currentView.view === 'search' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a] cursor-pointer'}`}>
              <span className="text-zinc-700">↳</span> Keyword Search
            </div>
            <div onClick={() => navigateTo({ view: 'fav_keywords' })} className={`px-4 py-2.5 rounded-lg font-bold text-xs cursor-pointer transition-all flex items-center gap-2 ${currentView.view === 'fav_keywords' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a]'}`}>
              <span className="text-zinc-700">↳</span> Favorited Keywords
            </div>
            <div onClick={() => navigateTo({ view: 'history_keywords' })} className={`px-4 py-2.5 rounded-lg font-bold text-xs cursor-pointer transition-all flex items-center gap-2 ${currentView.view === 'history_keywords' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a]'}`}>
              <span className="text-zinc-700">↳</span> Keyword History
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="px-4 text-[10px] font-black text-zinc-600 uppercase tracking-widest">Listing</h3>
            <div onClick={() => currentView.view === 'listing' ? navigateTo(currentView) : null} className={`px-4 py-2.5 rounded-lg font-bold text-xs transition-all flex items-center gap-2 ${currentView.view === 'listing' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a] cursor-pointer'}`}>
              <span className="text-zinc-700">↳</span> Listing Analyzer
            </div>
            <div onClick={() => navigateTo({ view: 'fav_listings' })} className={`px-4 py-2.5 rounded-lg font-bold text-xs cursor-pointer transition-all flex items-center gap-2 ${currentView.view === 'fav_listings' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a]'}`}>
              <span className="text-zinc-700">↳</span> Favorited Listings
            </div>
             <div onClick={() => navigateTo({ view: 'history_listings' })} className={`px-4 py-2.5 rounded-lg font-bold text-xs cursor-pointer transition-all flex items-center gap-2 ${currentView.view === 'history_listings' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a]'}`}>
              <span className="text-zinc-700">↳</span> Listing History
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="px-4 text-[10px] font-black text-zinc-600 uppercase tracking-widest">Shop</h3>
            <div onClick={() => currentView.view === 'shop' ? navigateTo(currentView) : null} className={`px-4 py-2.5 rounded-lg font-bold text-xs transition-all flex items-center gap-2 ${currentView.view === 'shop' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a] cursor-pointer'}`}>
              <span className="text-zinc-700">↳</span> Shop Analyzer
            </div>
            <div onClick={() => navigateTo({ view: 'fav_shops' })} className={`px-4 py-2.5 rounded-lg font-bold text-xs cursor-pointer transition-all flex items-center gap-2 ${currentView.view === 'fav_shops' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a]'}`}>
              <span className="text-zinc-700">↳</span> Favorited Shops
            </div>
            <div onClick={() => navigateTo({ view: 'history_shops' })} className={`px-4 py-2.5 rounded-lg font-bold text-xs cursor-pointer transition-all flex items-center gap-2 ${currentView.view === 'history_shops' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a]'}`}>
              <span className="text-zinc-700">↳</span> Shop History
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="px-4 text-[10px] font-black text-zinc-600 uppercase tracking-widest">Analytics</h3>
            <div onClick={() => navigateTo({ view: 'compare' })} className={`px-4 py-2.5 rounded-lg font-bold text-xs cursor-pointer transition-all flex items-center gap-2 ${currentView.view === 'compare' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a]'}`}>
              <span className="text-zinc-700">↳</span> Compare Benchmark
            </div>
          </div>

        </nav>

        <div className="p-4 border-t border-[#222]">
          <button onClick={handleSyncAll} disabled={syncing} className={`w-full py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${syncing ? 'bg-emerald-900/50 text-emerald-500 border border-emerald-900 cursor-wait' : 'bg-[#1a1a1a] text-zinc-400 hover:bg-emerald-600 hover:text-white border border-[#333] hover:border-emerald-500 shadow-lg shadow-black'}`}>
            <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
            {syncing ? 'SYNCING...' : 'SYNC ALL DATA'}
          </button>
        </div>
      </aside>
      )}

      <main className="flex-1 p-8 md:p-12 overflow-y-auto relative">
        <div className="max-w-4xl mx-auto flex gap-3 bg-[#111] p-2 rounded-2xl border border-[#333] mb-10 items-center shadow-2xl focus-within:border-sky-500/50 focus-within:ring-1 focus-within:ring-sky-500/50 transition-all z-50 relative">
          <div className="pl-4 text-zinc-500"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg></div>
          <input 
            className="flex-1 bg-transparent border-none outline-none text-zinc-100 px-2 py-3 text-sm placeholder-zinc-600 font-medium"
            placeholder="Derin analiz için Keyword, Link, Listing ID veya Shop ID girin..."
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchQuery)}
          />
          <button onClick={() => handleSearch(searchQuery)} className="bg-zinc-100 text-zinc-900 border-none px-8 py-3 rounded-xl font-black text-xs cursor-pointer hover:bg-sky-500 hover:text-white hover:scale-105 active:scale-95 transition-all shadow-lg">{loading ? "SCANNING..." : "HACK"}</button>
        </div>

        {errorData && !loading && (
          <div className="max-w-4xl mx-auto mb-8 bg-rose-950/30 border border-rose-900/50 rounded-2xl p-6 shadow-2xl animate-[fadeIn_0.3s]">
            <div className="flex items-center gap-3 mb-4 border-b border-rose-900/50 pb-4">
              <div className="p-2 bg-rose-900/50 rounded-lg text-rose-500"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg></div>
              <div><h3 className="font-black text-rose-500 tracking-tighter text-xl uppercase">Target Hack Failed</h3><p className="text-xs text-rose-400/70 font-mono">Etsy API isteği reddetti veya veri bulunamadı.</p></div>
            </div>
            <pre className="text-xs text-rose-300 font-mono whitespace-pre-wrap overflow-auto max-h-[300px] custom-scrollbar bg-black/50 p-4 rounded-xl border border-rose-900/30">{errorData}</pre>
          </div>
        )}

        {loading ? (
           <div className="flex flex-col items-center justify-center h-[50vh] space-y-4 animate-pulse">
             <div className="w-16 h-16 border-4 border-sky-500/30 border-t-sky-500 rounded-full animate-spin"></div>
             <p className="text-sky-500 font-mono text-xs uppercase tracking-[0.3em]">Extracting Data...</p>
           </div>
        ) : (
          !errorData && (
            <>
              <CurrentViewComponent />
            </>
          )
        )}
      </main>
    </div>
  );
};

export default App;