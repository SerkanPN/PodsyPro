// src/ListingDetail.tsx
import { useEffect, useRef, useState } from 'react';

// Helper for formatting timestamps
const formatTS = (ts: number | null) => {
  if (!ts) return 'N/A';
  return new Date(ts * 1000).toLocaleString();
};

// Helper for formatting price
const formatPrice = (amount: number, currency: string) => {
  return amount.toFixed(2) + " " + (currency || "USD");
};

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text).then(() => alert("Kopyalandı: " + text));
};

interface ListingDetailProps {
  listingId: string;
  onShopClick: (shopId: string) => void;
  onTagClick: (tag: string) => void;
  onBack: () => void;
}

const ListingDetail = ({ listingId, onShopClick, onTagClick, onBack }: ListingDetailProps) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (id: string, forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`http://127.0.0.1:8000/listing/${id}?force_refresh=${forceRefresh}`);
      if (!response.ok) throw new Error("Listing verisi alınamadı");
      
      const jsonData = await response.json();
      if (jsonData.ERROR) throw new Error(typeof jsonData.ERROR === 'string' ? jsonData.ERROR : JSON.stringify(jsonData.ERROR));
      
      setData(jsonData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(listingId);
  }, [listingId]);

  const listing = data?.listing || {};
  const reviews = data?.reviews || [];
  const history = data?.history || [];
  const price = typeof data?.price === 'number' ? data.price : 0;
  const all_history_json = JSON.stringify(history);
  
  const [showModal, setShowModal] = useState(false);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<any>(null);
  
  const [activeMetrics, setActiveMetrics] = useState({ views: true, favorites: true, quantity: true, price: true });
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  // --- ADVANCED ANALYTICS CALCULATIONS ---
  const createdTs = listing.original_creation_timestamp || listing.creation_timestamp || (Date.now() / 1000);
  const daysActive = Math.max(1, (Date.now() / 1000 - createdTs) / (24 * 60 * 60));
  const dailyViews = listing.views / daysActive;
  const dailyFavs = (listing.num_favorers || 0) / daysActive;
  const monthlyViews = (dailyViews * 30).toFixed(1);
  const monthlyFavs = (dailyFavs * 30).toFixed(1);
  
  let estimatedSalesFromStock = 0;
  if (history && history.length > 1) {
    for (let i = 0; i < history.length - 1; i++) {
      const prevStock = history[i + 1].quantity;
      const currStock = history[i].quantity;
      const prevMod = history[i + 1].last_modified_timestamp;
      const currMod = history[i].last_modified_timestamp;
      
      if (prevStock > currStock) {
        // Eğer veritabanında last_modified_timestamp varsa ve değişmişse satıştır.
        // Eski kayıtlarda bu değer null olabileceği için fallback sağlıyoruz.
        if (prevMod && currMod) {
          if (currMod !== prevMod) {
            estimatedSalesFromStock += (prevStock - currStock);
          }
        } else {
          estimatedSalesFromStock += (prevStock - currStock);
        }
      }
    }
  }

  let trendStatus = '⚖️ STABİL';
  if (history && history.length >= 10) {
    const recentHistory = history.slice(0, 10);
    const newest = recentHistory[0];
    const oldest = recentHistory[9];
    
    const stockDecreased = newest.quantity < oldest.quantity;
    const viewsIncreased = newest.views > oldest.views;
    const favsIncreased = newest.favorites > oldest.favorites;

    if (stockDecreased && viewsIncreased && favsIncreased) {
      trendStatus = '🔥 TREND (Stok düşüyor, ilgi artıyor)';
    }
  } else {
    trendStatus = '⏳ Veri Toplanıyor (Min. 10 kayıt)';
  }
  // ----------------------------------------

  useEffect(() => {
    if (!document.getElementById('chartjs-script')) {
      const script = document.createElement('script');
      script.id = 'chartjs-script';
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  useEffect(() => {
    if (showModal && chartRef.current && (window as any).Chart) {
      if (chartInstance.current) chartInstance.current.destroy();
      
      const ctx = chartRef.current.getContext('2d');
      const ChartConstructor = (window as any).Chart;
      
      let chartData = [];
      try {
        const rawData = typeof all_history_json === 'string' ? JSON.parse(all_history_json) : all_history_json;
        if (rawData && rawData.length > 0) {
          const reversed = rawData.slice().reverse();
          // Aynı günün verilerini tekilleştirme (sadece o günün en son verisini alıyoruz)
          const groupedByDay: { [key: string]: any } = {};
          reversed.forEach((d: any) => {
            if (d.capture_time) {
              const day = d.capture_time.split('T')[0];
              groupedByDay[day] = d; // reversed olduğu için günün en son saati en son yazılır ve üstüne yazar
            }
          });
          chartData = Object.values(groupedByDay);
        }
      } catch (e) {
        console.error("History parse error", e);
        return;
      }

      if (dateRange.start && chartData) chartData = chartData.filter((d: any) => d.capture_time >= dateRange.start);
      if (dateRange.end && chartData) chartData = chartData.filter((d: any) => d.capture_time <= dateRange.end + " 23:59:59");

      const labels = chartData ? chartData.map((d: any) => d.capture_time) : [];
      const datasets = [];

      if (chartData) {
        if (activeMetrics.views) datasets.push({ label: 'İzlenme', data: chartData.map((d: any) => d.views), borderColor: '#0ea5e9', backgroundColor: '#0ea5e915', fill: true, tension: 0.3 });
        if (activeMetrics.favorites) datasets.push({ label: 'Favori', data: chartData.map((d: any) => d.favorites), borderColor: '#f43f5e', backgroundColor: '#f43f5e15', fill: true, tension: 0.3 });
        if (activeMetrics.quantity) datasets.push({ label: 'Stok', data: chartData.map((d: any) => d.quantity), borderColor: '#10b981', backgroundColor: '#10b98115', fill: true, tension: 0.3 });
        if (activeMetrics.price) datasets.push({ label: 'Fiyat', data: chartData.map((d: any) => d.price), borderColor: '#f59e0b', backgroundColor: '#f59e0b15', fill: true, tension: 0.3 });
      }

      chartInstance.current = new ChartConstructor(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { grid: { color: '#222' } }, x: { grid: { color: '#222' } } },
          plugins: { legend: { display: false } }
        }
      });
    }
  }, [showModal, activeMetrics, dateRange, all_history_json]);

  const copyAllTags = () => {
    if (!listing.tags || listing.tags.length === 0) return;
    copyToClipboard(listing.tags.join(','));
  };

  const onToggleFollow = async (id: string) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/toggle-follow/listing/${encodeURIComponent(id)}`, { method: 'POST' });
      const resData = await res.json();
      if (resData.status === 'success') {
        setData((prevData: any) => ({
          ...prevData,
          listing: { ...prevData.listing, is_tracked: resData.is_tracked }
        }));
      }
    } catch (err) {
      alert("Takip işlemi başarısız.");
    }
  };

  const HeartIcon = () => {
    if (listing.is_tracked) {
      return (
        <svg className="w-5 h-5 text-white fill-white transition" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5 text-white transition" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
      </svg>
    );
  };

  if (loading) return <div className="text-white text-center mt-20 font-black animate-pulse">VERİ YÜKLENİYOR...</div>;
  if (error) return <div className="text-red-500 text-center mt-20">Hata: {error}</div>;
  if (!data) return <div className="text-zinc-500 text-center mt-20">Veri bulunamadı.</div>;

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20 animate-[fadeIn_0.5s]">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-zinc-800 pb-6 gap-6">
        <div className="space-y-2">
          <button onClick={onBack} className="group flex items-center space-x-2 text-gray-400 hover:text-white transition cursor-pointer bg-transparent border-none p-0 mb-4">
            <div className="p-2 bg-[#2a2a2a] group-hover:bg-[#333] rounded-lg transition border border-[#3a3a3a]">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            </div>
            <span className="font-black text-sm tracking-wide">GERİ DÖN</span>
          </button>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white leading-tight">{listing.title}</h1>
            <button onClick={() => copyToClipboard(listing.title)} className="p-2 hover:bg-zinc-800 rounded-lg transition shrink-0 text-zinc-500 hover:text-white" title="Başlığı Kopyala">
              <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
            </button>
            <button onClick={() => fetchData(listingId, true)} className="p-2 hover:bg-zinc-800 rounded-lg transition shrink-0 text-zinc-500 hover:text-sky-400" title="Veriyi API'den Taze Çek">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-zinc-500 font-mono text-xs md:text-sm">
            <span className="flex items-center gap-1">ID: <span className="text-zinc-300 font-bold">{listing.listing_id}</span>
            <button onClick={() => copyToClipboard(listing.listing_id)} className="hover:text-white transition ml-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
            </button></span>
            <span className="bg-sky-500/10 text-sky-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase border border-sky-500/20">{listing.state}</span>
            <span className="bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded text-[10px] uppercase border border-zinc-700">{listing.listing_type}</span>
          </div>
        </div>
        <div className="flex space-x-3 w-full md:w-auto">
          <button onClick={() => onToggleFollow(listing.listing_id)} className={`flex-1 md:flex-none justify-center px-6 py-3 transition rounded-xl font-black text-xs flex items-center space-x-2 shadow-lg cursor-pointer tracking-wide ${listing.is_tracked ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/20' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20'}`}>
            <HeartIcon />
            <span>{listing.is_tracked ? 'UNFOLLOW' : 'FOLLOW'}</span>
          </button>
          <a href={listing.url} target="_blank" rel="noreferrer" className="flex-1 md:flex-none justify-center px-6 py-3 bg-sky-600 rounded-xl hover:bg-sky-500 transition font-black text-xs flex items-center text-white tracking-wide shadow-lg shadow-sky-900/20">
            ETSY'DE GÖR ↗
          </a>
        </div>
      </div>

      {/* STATS GRID */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-xl hover:border-zinc-700 transition">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Satış Fiyatı</p>
          <p className="text-2xl font-black text-sky-400">{price?.toFixed(2)} <span className="text-xs text-zinc-600 font-mono">{listing.price?.currency_code}</span></p>
        </div>
        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-xl hover:border-zinc-700 transition">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Görüntülenme</p>
          <p className="text-2xl font-black text-zinc-100">{listing.views || 0}</p>
        </div>
        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-xl hover:border-zinc-700 transition">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Favoriler</p>
          <p className="text-2xl font-black text-rose-500">❤️ {listing.num_favorers || 0}</p>
        </div>
        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-xl hover:border-zinc-700 transition">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Toplam Stok</p>
          <p className="text-2xl font-black text-emerald-500">{listing.quantity}</p>
        </div>
        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-xl hover:border-zinc-700 transition col-span-2 lg:col-span-1">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Öne Çıkma Sırası</p>
          <p className="text-2xl font-black text-zinc-100">{listing.featured_rank || 'N/A'}</p>
        </div>
      </div>

      {/* ADVANCED CALCULATIONS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <div className="bg-sky-900/10 p-5 rounded-2xl border border-sky-900/30 shadow-xl">
          <p className="text-[10px] font-bold text-sky-500 uppercase tracking-widest mb-1">Aylık Ort. İzlenme</p>
          <p className="text-2xl font-black text-sky-400">{monthlyViews}</p>
        </div>
        <div className="bg-rose-900/10 p-5 rounded-2xl border border-rose-900/30 shadow-xl">
          <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest mb-1">Aylık Ort. Favori</p>
          <p className="text-2xl font-black text-rose-400">{monthlyFavs}</p>
        </div>
        <div className="bg-emerald-900/10 p-5 rounded-2xl border border-emerald-900/30 shadow-xl">
          <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-1">Stoktan Tahmini Satış</p>
          <p className="text-2xl font-black text-emerald-400">{estimatedSalesFromStock} <span className="text-[10px] text-zinc-500">adet</span></p>
        </div>
        <div className="bg-amber-900/10 p-5 rounded-2xl border border-amber-900/30 shadow-xl">
          <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-1">Trend Durumu</p>
          <p className="text-sm font-black text-amber-400 mt-2">{trendStatus}</p>
          <p className="text-[10px] text-zinc-500 mt-1">Kayıtlı Veri: {history ? history.length : 0} adet</p>
        </div>
      </div>

      {/* HISTORY TABLE */}
      {history && history.length > 0 && (
        <details className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden shadow-xl group" open>
          <summary className="p-5 border-b border-zinc-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-zinc-900/50 cursor-pointer list-none select-none">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-black italic text-sky-500 uppercase tracking-tighter">Gelişim ve Değişim Analizi</h2>
              <svg className="w-5 h-5 text-sky-500 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
            <button onClick={(e) => { e.stopPropagation(); setShowModal(true); }} className="bg-sky-600 hover:bg-sky-500 text-white px-5 py-2 rounded-lg font-bold text-[10px] transition uppercase whitespace-nowrap cursor-pointer shadow-lg shadow-sky-900/20">Tüm Geçmişi Grafik Olarak Gör</button>
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[600px]">
              <thead className="bg-zinc-950 text-zinc-500 font-mono text-[10px] uppercase">
                <tr>
                  <th className="p-4 font-bold tracking-wider">Kayıt Tarihi / Saati</th>
                  <th className="p-4 font-bold tracking-wider">Görüntülenme</th>
                  <th className="p-4 font-bold tracking-wider">Favori</th>
                  <th className="p-4 font-bold tracking-wider">Stok</th>
                  <th className="p-4 font-bold tracking-wider">Fiyat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {history.slice(0, 4).map((snap: any, i: number) => (
                  <tr key={i} className={`${i === 0 ? 'bg-sky-500/5' : ''} hover:bg-zinc-800/50 transition`}>
                    <td className="p-4 font-bold text-sky-400 font-mono text-xs">{snap.capture_time}</td>
                    <td className="p-4 text-zinc-300 font-medium">{snap.views}</td>
                    <td className="p-4 text-rose-400 font-bold">❤️ {snap.favorites}</td>
                    <td className="p-4 text-emerald-400 font-bold">{snap.quantity}</td>
                    <td className="p-4 font-mono text-zinc-400">${snap.price?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          
          {/* MEDIA GALLERY */}
          <details className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden shadow-xl group" open>
            <summary className="p-5 border-b border-zinc-800 bg-zinc-900/50 cursor-pointer list-none flex justify-between items-center select-none">
              <h2 className="text-lg font-black italic text-sky-500 uppercase tracking-tighter">Media Gallery</h2>
              <svg className="w-6 h-6 text-sky-500 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"></path></svg>
            </summary>
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {listing.videos && listing.videos.map((vid: any, i: number) => (
                <div key={`video-${i}`} className="relative group overflow-hidden rounded-lg h-28 md:h-32 border-2 border-sky-500/50 bg-black col-span-2 sm:col-span-2">
                  <video src={vid.video_url} autoPlay loop muted playsInline className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition duration-500" />
                  <div className="absolute top-2 left-2 bg-sky-600 text-white text-[9px] font-black px-2 py-1 rounded shadow-lg tracking-widest uppercase">VIDEO</div>
                  <a href={vid.video_url} target="_blank" rel="noreferrer" className="absolute inset-0 z-10 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition">
                    <span className="text-[10px] font-bold text-white bg-black/60 px-3 py-1 rounded-full">BÜYÜT</span>
                  </a>
                </div>
              ))}
              {listing.images?.map((img: any, i: number) => (
                <a key={`img-${i}`} href={img.url_fullxfull} target="_blank" rel="noreferrer" className="relative group overflow-hidden rounded-lg h-28 md:h-32 border border-zinc-800 bg-black">
                  <img src={img.url_570xN} className="w-full h-full object-cover group-hover:scale-110 transition duration-500" alt="" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                    <span className="text-[10px] font-bold text-white">BÜYÜT</span>
                  </div>
                </a>
              ))}
            </div>
          </details>

          {/* REVIEWS */}
          <details className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden shadow-xl group">
            <summary className="p-5 border-b border-zinc-800 bg-zinc-900/50 cursor-pointer list-none flex justify-between items-center select-none">
              <h2 className="text-lg font-black italic text-sky-500 uppercase tracking-tighter">Recent Item Reviews</h2>
              <svg className="w-6 h-6 text-sky-500 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"></path></svg>
            </summary>
            <div className="p-6 space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {reviews && reviews.length > 0 ? reviews.map((rev: any, i: number) => (
                <div key={i} className="bg-zinc-950 p-5 rounded-xl border border-zinc-800 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-rose-400 font-black text-xs uppercase tracking-widest">Rating: {rev.rating} ⭐</span>
                    <span className="text-[10px] text-zinc-600 font-mono">{formatTS(rev.created_timestamp)}</span>
                  </div>
                  <p className="text-zinc-300 text-sm italic leading-relaxed">"{rev.review}"</p>
                </div>
              )) : (
                <p className="text-zinc-500 text-sm italic">No specific reviews found for this item.</p>
              )}
            </div>
          </details>

          {/* DESCRIPTION */}
          <details className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden shadow-xl group">
            <summary className="p-5 border-b border-zinc-800 bg-zinc-900/50 cursor-pointer list-none flex justify-between items-center select-none">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-black italic text-sky-500 uppercase tracking-tighter">Product Description</h2>
                <svg className="w-6 h-6 text-sky-500 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"></path></svg>
              </div>
              <button onClick={(e) => { e.stopPropagation(); copyToClipboard(listing.description); }} className="text-xs font-bold text-zinc-500 hover:text-white flex items-center space-x-1 transition cursor-pointer bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                <span className="hidden sm:inline">TÜMÜNÜ KOPYALA</span>
              </button>
            </summary>
            <div className="p-6 max-h-[400px] overflow-y-auto custom-scrollbar">
              <p className="text-zinc-300 whitespace-pre-wrap leading-relaxed text-sm">{listing.description}</p>
            </div>
          </details>

          {/* INVENTORY */}
          {listing.inventory?.products && (
            <details className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden shadow-xl group" open>
              <summary className="p-5 border-b border-zinc-800 bg-zinc-900/50 cursor-pointer list-none flex justify-between items-center select-none">
                <h2 className="text-lg font-black italic text-sky-500 uppercase tracking-tighter">Inventory & Variations</h2>
                <svg className="w-6 h-6 text-sky-500 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"></path></svg>
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse min-w-[500px]">
                  <thead>
                    <tr className="bg-zinc-950 text-zinc-500 font-mono text-[11px] uppercase tracking-widest">
                      <th className="p-4 border-b border-zinc-800">SKU</th>
                      <th className="p-4 border-b border-zinc-800">Özellikler</th>
                      <th className="p-4 border-b border-zinc-800">Fiyat</th>
                      <th className="p-4 border-b border-zinc-800">Stok</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {listing.inventory.products.map((product: any, i: number) => (
                      <tr key={i} className="hover:bg-zinc-800/50 transition">
                        <td className="p-4 font-mono text-zinc-500">{product.sku || 'N/A'}</td>
                        <td className="p-4">
                          {product.property_values?.map((pv: any, j: number) => (
                            <div key={j} className="flex flex-wrap items-center gap-1">
                              <span className="text-sky-500 font-bold text-[10px] uppercase">{pv.property_name}:</span>
                              <span className="text-zinc-300 font-medium">{pv.values.join(', ')}</span>
                            </div>
                          ))}
                        </td>
                        <td className="p-4 font-bold text-sky-400 font-mono whitespace-nowrap">
                          {product.offerings && product.offerings.length > 0 && product.offerings[0].price ? 
                            formatPrice(product.offerings[0].price.amount / (product.offerings[0].price.divisor || 1), product.offerings[0].price.currency_code) : 
                            'N/A'}
                        </td>
                        <td className="p-4">
                          <span className="bg-zinc-950 px-3 py-1 rounded-full font-bold text-emerald-500 border border-emerald-900/30 text-xs">
                            {product.offerings && product.offerings.length > 0 ? product.offerings[0].quantity : 0}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>

        <div className="space-y-8">
          {/* SHOP INTELLIGENCE */}
          <details className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden shadow-xl group" open>
            <summary className="p-5 border-b border-zinc-800 bg-zinc-900/50 cursor-pointer list-none flex justify-between items-center select-none">
              <h2 className="text-lg font-black italic text-sky-500 uppercase tracking-tighter">Shop Intelligence</h2>
              <svg className="w-6 h-6 text-sky-500 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"></path></svg>
            </summary>
            <div className="p-6 flex items-center space-x-4">
              <div className="relative shrink-0">
                <img src={listing.shop?.icon_url_fullxfull || ''} className="w-16 h-16 rounded-xl border-2 border-zinc-700 shadow-lg" alt="" />
                <div className="absolute -bottom-2 -right-2 bg-sky-600 p-1.5 rounded-lg shadow-xl">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"></path><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.051 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"></path></svg>
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex items-center space-x-2">
                  <button onClick={() => onShopClick(listing.shop?.shop_id)} className="font-black text-xl tracking-tight hover:text-sky-400 transition decoration-sky-800 underline truncate text-white cursor-pointer">
                    {listing.shop?.shop_name || 'Unknown'}
                  </button>
                  <button onClick={() => copyToClipboard(listing.shop?.shop_name)} className="text-gray-600 hover:text-sky-400 shrink-0"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg></button>
                </div>
                <p className="text-xs font-mono text-zinc-500">ID: {listing.shop?.shop_id}</p>
              </div>
            </div>
          </details>

          {/* TAGS */}
          <details className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden shadow-xl group" open>
            <summary className="p-5 border-b border-zinc-800 bg-zinc-900/50 cursor-pointer list-none flex justify-between items-center select-none">
              <h2 className="text-lg font-black italic text-sky-500 uppercase tracking-tighter">Tags & Keywords</h2>
              <svg className="w-6 h-6 text-sky-500 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"></path></svg>
            </summary>
            <div className="p-6 space-y-6">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-black text-sky-500 uppercase tracking-[0.2em]">Tags (Keywords)</h3>
                  <button onClick={copyAllTags} className="bg-sky-500/10 hover:bg-sky-500 text-sky-500 hover:text-white px-3 py-1 rounded-lg text-[10px] font-black transition uppercase cursor-pointer">TOPLU KOPYALA</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {listing.tags?.map((tag: string, i: number) => (
                    <div 
                      key={i} 
                      onClick={() => onTagClick(tag)} 
                      className="group/tag flex items-center bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 hover:border-sky-500 hover:bg-sky-500/10 transition cursor-pointer shadow-sm hover:shadow-sky-900/20"
                      title={`"${tag}" kelimesini analiz et`}
                    >
                      <span className="text-[11px] font-bold text-zinc-300 group-hover/tag:text-sky-400 uppercase tracking-tight">{tag}</span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); copyToClipboard(tag); }} 
                        className="ml-2 opacity-0 group-hover/tag:opacity-100 text-sky-500 hover:text-white transition cursor-pointer" 
                        title="Kopyala"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-4 pt-4 border-t border-zinc-800">
                <h3 className="text-xs font-black text-emerald-500 uppercase tracking-[0.2em]">Materials Used</h3>
                <div className="flex flex-wrap gap-2">
                  {listing.materials?.map((mat: string, i: number) => (
                    <span key={i} className="bg-emerald-900/10 text-emerald-400 text-[10px] font-black px-3 py-1 rounded-full border border-emerald-900/30 uppercase tracking-tight">
                      {mat}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </details>

          {/* TECHNICAL & ADVANCED ATTRIBUTES */}
          <details className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden shadow-xl group" open>
            <summary className="p-5 border-b border-zinc-800 bg-zinc-900/50 cursor-pointer list-none flex justify-between items-center select-none">
              <h2 className="text-lg font-black italic text-sky-500 uppercase tracking-tighter">Attributes & POD</h2>
              <svg className="w-6 h-6 text-sky-500 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"></path></svg>
            </summary>
            <div className="p-6 space-y-4">
              <div className="space-y-3 text-xs font-mono uppercase text-zinc-500">
                <div className="flex justify-between"><span>Who Made:</span> <span className="text-zinc-200 text-right">{listing.who_made}</span></div>
                <div className="flex justify-between"><span>When Made:</span> <span className="text-zinc-200 text-right">{listing.when_made}</span></div>
                <div className="flex justify-between"><span>Taxonomy ID:</span> <span className="text-sky-500 text-right">{listing.taxonomy_id}</span></div>
                <div className="flex justify-between"><span>Is Digital:</span> <span className="text-zinc-200 text-right">{listing.is_digital ? 'YES' : 'NO'}</span></div>
                <div className="flex justify-between"><span>Is Customizable:</span> <span className="text-zinc-200 text-right">{listing.is_customizable ? 'YES' : 'NO'}</span></div>
                <div className="flex justify-between"><span>Is Personalizable:</span> <span className="text-zinc-200 text-right">{listing.is_personalizable ? 'YES' : 'NO'}</span></div>
                <div className="flex justify-between border-t border-zinc-800 pt-2 mt-2"><span>Has Variations:</span> <span className="text-zinc-200 text-right">{listing.has_variations ? 'YES' : 'NO'}</span></div>
                
                {/* POD PARTNERS REVEAL */}
                {listing.production_partners && listing.production_partners.length > 0 && (
                  <div className="flex flex-col mt-4 border-t border-zinc-800 pt-4">
                    <span className="text-emerald-500 mb-2 font-black tracking-widest text-[10px]">PRODUCTION PARTNERS:</span>
                    <div className="flex flex-wrap gap-2">
                      {listing.production_partners.map((partner: any, i: number) => (
                        <span key={i} className="bg-emerald-900/20 text-emerald-400 px-3 py-1.5 rounded-lg text-[10px] font-bold border border-emerald-900/30">
                          {typeof partner === 'string' ? partner : partner.partner_name || 'Bilinmeyen Partner'}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </details>

          {/* STYLE */}
          {listing.style && listing.style.length > 0 && (
            <details className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden shadow-xl group">
              <summary className="p-5 border-b border-zinc-800 bg-zinc-900/50 cursor-pointer list-none flex justify-between items-center select-none">
                <h2 className="text-lg font-black italic text-rose-500 uppercase tracking-tighter">Style Elements</h2>
                <svg className="w-6 h-6 text-rose-500 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"></path></svg>
              </summary>
              <div className="p-6 flex flex-wrap gap-2">
                {listing.style.map((s: string, i: number) => (
                  <span key={i} className="bg-rose-900/20 border border-rose-900/30 text-rose-400 px-3 py-1 rounded-lg text-[10px] font-black uppercase">{s}</span>
                ))}
              </div>
            </details>
          )}

          {/* METADATA */}
          <details className="bg-black/20 rounded-2xl border border-zinc-800 overflow-hidden group">
            <summary className="p-5 border-b border-zinc-800 cursor-pointer list-none flex justify-between items-center select-none">
              <h2 className="text-lg font-black italic text-zinc-600 uppercase tracking-tighter font-sans">Metadata Engine</h2>
              <svg className="w-6 h-6 text-zinc-600 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"></path></svg>
            </summary>
            <div className="p-6 space-y-3 font-mono text-[10px] text-zinc-500">
              <div className="flex flex-col sm:flex-row justify-between uppercase gap-1"><span>Original Created:</span> <span className="text-zinc-300">{formatTS(listing.original_creation_timestamp)}</span></div>
              <div className="flex flex-col sm:flex-row justify-between uppercase gap-1"><span>First Published:</span> <span className="text-zinc-300">{formatTS(listing.creation_timestamp)}</span></div>
              <div className="flex flex-col sm:flex-row justify-between uppercase gap-1"><span>Last Modified:</span> <span className="text-sky-500 font-bold">{formatTS(listing.last_modified_timestamp)}</span></div>
              <div className="flex flex-col sm:flex-row justify-between uppercase gap-1"><span>Updated Date:</span> <span className="text-zinc-300">{formatTS(listing.updated_timestamp)}</span></div>
              <div className="flex flex-col sm:flex-row justify-between uppercase gap-1"><span>State Changed:</span> <span className="text-zinc-300">{formatTS(listing.state_timestamp)}</span></div>
              <div className="flex flex-col sm:flex-row justify-between uppercase gap-1"><span>Ending Date:</span> <span className="text-rose-900 font-bold">{formatTS(listing.ending_timestamp)}</span></div>
            </div>
          </details>
        </div>
      </div>

      {/* GRAPH MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center p-4 sm:p-8 backdrop-blur-sm">
          <div className="bg-zinc-900 w-full max-w-6xl rounded-3xl border border-zinc-800 p-6 sm:p-10 relative flex flex-col h-[90vh] shadow-2xl">
            <button onClick={() => setShowModal(false)} className="absolute top-6 right-6 text-zinc-500 hover:text-white uppercase font-black text-xs transition cursor-pointer">Kapat [ESC]</button>
            <h2 className="text-2xl sm:text-3xl font-black italic text-sky-500 uppercase tracking-tighter mb-6 sm:mb-8 mt-4 sm:mt-0">Performance History Graph</h2>
            <div className="flex flex-col md:flex-row gap-4 mb-6 sm:mb-8 bg-zinc-950 p-4 sm:p-6 rounded-2xl border border-zinc-800">
              <input type="date" onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-white text-xs outline-none focus:border-sky-500 w-full md:w-auto" />
              <input type="date" onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-white text-xs outline-none focus:border-sky-500 w-full md:w-auto" />
              <div className="flex items-center gap-2 overflow-x-auto pb-1 w-full">
                {['views', 'favorites', 'quantity', 'price'].map(key => (
                  <button 
                    key={key}
                    onClick={() => setActiveMetrics({ ...activeMetrics, [key]: !activeMetrics[key as keyof typeof activeMetrics] })}
                    className={`px-4 py-2 rounded-lg text-[10px] font-black border border-zinc-800 whitespace-nowrap transition cursor-pointer ${activeMetrics[key as keyof typeof activeMetrics] ? 'bg-sky-500 text-white border-sky-500 shadow-lg shadow-sky-500/20' : 'bg-zinc-900 text-zinc-500'}`}
                  >
                    {key.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-grow bg-zinc-950 rounded-2xl p-4 sm:p-6 border border-zinc-800 relative min-h-[300px]">
              <canvas ref={chartRef}></canvas>
            </div>
          </div>
        </div>
      )}

      {/* RAW DUMP */}
      <div className="mt-20">
        <details className="bg-black/50 rounded-2xl border border-emerald-900/20 group text-center">
          <summary className="p-6 cursor-pointer text-green-900 font-black uppercase text-[10px] list-none tracking-[0.5em] tracking-tighter">RAW API ENGINE DUMP</summary>
          <div className="p-8 border-t border-green-900/10">
            <pre className="text-[10px] text-emerald-800 font-mono text-left leading-tight overflow-auto">{JSON.stringify(listing, null, 2)}</pre>
          </div>
        </details>
      </div>
    </div>
  );
};

export default ListingDetail;
