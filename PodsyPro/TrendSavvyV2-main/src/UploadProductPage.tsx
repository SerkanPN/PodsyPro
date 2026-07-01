import React, { useState, useEffect, useRef } from 'react';

interface UploadProductPageProps {
  shopId: string;
  onBack: () => void;
}

// Section bileseni UploadProductPage disinda tanimlandi (Render/Focus sorununu cozmek icin)
const Section = ({ title, desc, children }: { title: string, desc?: string, children: React.ReactNode }) => (
  <section className="bg-white/5 p-8 rounded-2xl border border-white/10 shadow-xl mb-8">
    <div className="mb-6">
      <h3 className="text-xl font-bold text-white">{title}</h3>
      {desc && <p className="text-sm text-zinc-400 mt-1">{desc}</p>}
    </div>
    <div className="space-y-6">
      {children}
    </div>
  </section>
);

const UploadProductPage: React.FC<UploadProductPageProps> = ({ shopId, onBack }) => {

  const photoRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);
  const itemDetailsRef = useRef<HTMLDivElement>(null);
  const itemOptionsRef = useRef<HTMLDivElement>(null);
  const pricingShippingRef = useRef<HTMLDivElement>(null);

  const scrollToRef = (ref: React.RefObject<HTMLDivElement>) => {
    if (ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleCategorySelect = () => {
    const val = prompt("Lütfen bir Taxonomy ID girin (Örn: 1):");
    if (val && !isNaN(parseInt(val))) {
      setFormData(prev => ({ ...prev, taxonomy_id: val }));
    }
  };

  // --- FORM STATE ---
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: '',
    quantity: '1',
    sku: '',
    who_made: 'i_did',
    when_made: 'made_to_order',
    is_supply: 'false',
    digital_creation: 'created_by_me',
    type: 'download',
    taxonomy_id: '',
    tags: '',
    materials: '',
    shipping_profile_id: '',
    is_personalizable: false,
    personalization_is_required: false,
    personalization_char_count_max: 256,
    personalization_instructions: '',
    shop_section: '',
    feature_listing: false,
    renewal_option: 'automatic'
  });

  // --- ETSY API STATE ---
  const [loadingEtsyData, setLoadingEtsyData] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shippingProfiles, setShippingProfiles] = useState<any[]>([]);

  // Sabit Secenekler
  const whoMadeOptions = [
    { id: 'i_did', label: 'I did (Ben yaptım)' },
    { id: 'collective', label: 'A member of my shop (Mağaza Üyem)' },
    { id: 'someone_else', label: 'Another company or person (Başka firma/kişi)' }
  ];
  
  const whenMadeOptions = [
    { id: 'made_to_order', label: 'Siparişe Göre (Made to order)' },
    { id: '2020_2024', label: 'Son Zamanlarda (2020-2024)' },
    { id: '2010_2019', label: '2010 - 2019' },
    { id: '2000_2009', label: '2000 - 2009' },
    { id: 'before_2000', label: 'Vintage (2000 Öncesi)' }
  ];

  useEffect(() => {
    if (!shopId || shopId === "undefined" || shopId === "null") {
        setLoadingEtsyData(false);
        return;
    }
    const fetchEtsyOptions = async () => {
      setLoadingEtsyData(true);
      try {
        const token = localStorage.getItem('token');
        const shippingRes = await fetch(http://127.0.0.1:8000/api/etsy/connections//shipping-profiles, {
            headers: { 'Authorization': Bearer  }
        });
        if (shippingRes.ok) {
            const data = await shippingRes.json();
            if (data.results) {
                setShippingProfiles(data.results);
                if (data.results.length > 0) {
                    setFormData(prev => ({ ...prev, shipping_profile_id: data.results[0].shipping_profile_id.toString() }));
                }
            }
        }
      } catch (err) {
        console.error("API error", err);
      } finally {
        setLoadingEtsyData(false);
      }
    };
    fetchEtsyOptions();
  }, [shopId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setFormData(prev => ({ ...prev, [name]: val }));
  };

  const handlePublish = async () => {
    if (!formData.title || !formData.description || !formData.price || !formData.quantity || !formData.taxonomy_id) {
        alert("Lütfen zorunlu alanları (*) doldurun: Başlık, Açıklama, Fiyat, Miktar, Taxonomy ID");
        return;
    }
    
    if (!shopId || shopId === "undefined" || shopId === "null") {
        alert("Hata: Mağazanızla bağlantı kurulamadı. Lütfen mağazayı silip yeniden bağlayın.");
        return;
    }

    setIsSubmitting(true);
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(http://127.0.0.1:8000/api/etsy/connections//create-listing, {
            method: 'POST',
            headers: { 
                'Authorization': Bearer ,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: formData.title,
                description: formData.description,
                price: parseFloat(formData.price),
                quantity: parseInt(formData.quantity),
                who_made: formData.who_made,
                when_made: formData.when_made,
                taxonomy_id: parseInt(formData.taxonomy_id),
                is_supply: formData.is_supply === 'true',
                type: formData.type === 'download' ? 'digital' : 'physical',
                shipping_profile_id: formData.type !== 'download' && formData.shipping_profile_id ? parseInt(formData.shipping_profile_id) : null,
                tags: formData.tags,
                materials: formData.materials
            })
        });
        
        if (res.ok) {
            const data = await res.json();
            alert("BAŞARILI! Ürün taslak olarak mağazanıza eklendi. Listing ID: " + data.listing_id);
            onBack();
        } else {
            const err = await res.text();
            alert("HATA: " + err);
        }
    } catch (err) {
        console.error(err);
        alert("Sistemsel bir hata oluştu.");
    } finally {
        setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-32 px-4 sm:px-6 lg:px-8 animate-[fadeIn_0.5s]">
      {/* HEADER */}
      <div className="flex items-center justify-between border-b border-white/10 pb-6 pt-8 mb-8">
        <button onClick={onBack} className="flex items-center gap-2 text-zinc-400 hover:text-white transition group">
          <div className="p-2 bg-white/5 group-hover:bg-white/10 rounded-lg border border-white/5">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          </div>
          <span className="font-bold text-sm">İptal ve Geri Dön</span>
        </button>
      </div>

      <div className="mb-8">
        <h2 className="text-3xl font-black text-white tracking-tight">Listings &gt; Edit listing</h2>
        <div className="flex gap-4 mt-4 border-b border-white/10 pb-4 text-sm font-bold text-zinc-400">
          <span onClick={() => scrollToRef(photoRef)} className="hover:text-white cursor-pointer transition text-sky-400 border-b-2 border-sky-400 pb-4 -mb-[17px]">Photo & Video</span>
          <span onClick={() => scrollToRef(categoryRef)} className="hover:text-white cursor-pointer transition">Category</span>
          <span onClick={() => scrollToRef(itemDetailsRef)} className="hover:text-white cursor-pointer transition">Item Details</span>
          <span onClick={() => scrollToRef(itemOptionsRef)} className="hover:text-white cursor-pointer transition">Item Options</span>
          <span onClick={() => scrollToRef(pricingShippingRef)} className="hover:text-white cursor-pointer transition">Pricing & Shipping</span>
        </div>
      </div>

      {/* 1. PHOTO AND VIDEO */}
      <div ref={photoRef}>
        <Section title="Photo and video" desc="Show off different angles, available options, or even a peek behind the scenes at your process.">
          <div className="border-2 border-dashed border-white/20 rounded-2xl p-12 flex flex-col items-center justify-center text-center cursor-pointer hover:border-sky-500/50 hover:bg-sky-500/5 transition">
            <svg className="w-12 h-12 text-zinc-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
            <p className="text-zinc-300 font-bold text-lg">Add up to 20 photos and 2 videos.*</p>
            <button className="mt-4 px-4 py-2 border border-white/20 rounded-full text-xs font-bold hover:bg-white/5 transition flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>
              Adjust thumbnails
            </button>
          </div>
        </Section>
      </div>

      {/* 2. CATEGORY */}
      <div ref={categoryRef}>
        <Section title="Category">
          <div>
            <label className="block text-sm font-bold text-zinc-300 mb-2">Selected category *</label>
            <div className="flex items-center justify-between bg-black/40 border border-white/10 rounded-xl px-4 py-3">
              <div>
                <p className="text-white font-bold">{formData.taxonomy_id ? Kategori ID:  : 'Kategori Seçilmedi'}</p>
                <p className="text-xs text-zinc-500">Lütfen geçerli bir Taxonomy ID girin veya seçin.</p>
              </div>
              <button onClick={handleCategorySelect} className="px-4 py-1.5 border border-white/20 rounded-full text-xs font-bold hover:bg-white/5 transition">Kategori Seç</button>
            </div>
            <input type="number" name="taxonomy_id" value={formData.taxonomy_id} onChange={handleChange} className="w-full mt-4 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500 transition" placeholder="Etsy Taxonomy ID (Örn: 1)" required />
          </div>
        </Section>
      </div>

      {/* 3. ITEM DETAILS */}
      <div ref={itemDetailsRef}>
        <Section title="Item details" desc="Help buyers understand your item better, and share any special options you offer.">
          <div>
            <label className="block text-sm font-bold text-zinc-300 mb-2">Title *</label>
            <p className="text-xs text-zinc-500 mb-2">Make sure your title is easy to understand and clearly describes what you're selling.</p>
            <input type="text" name="title" value={formData.title} onChange={handleChange} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500 transition" placeholder="Ürün başlığını buraya girin..." maxLength={140} required />
            <p className="text-right text-[10px] text-zinc-600 mt-1">{formData.title.length} / 140</p>
          </div>
          <div>
            <label className="block text-sm font-bold text-zinc-300 mb-2">Description *</label>
            <p className="text-xs text-zinc-500 mb-2">What makes your item special? Buyers will only see the first few lines unless they expand the description.</p>
            <textarea name="description" value={formData.description} onChange={handleChange} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500 transition min-h-[200px]" required></textarea>
          </div>
        </Section>
      </div>

      {/* 4. ITEM OPTIONS */}
      <div ref={itemOptionsRef}>
        <Section title="Item options" desc="Add variations and personalization options.">
          <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700">
            <h4 className="text-white font-bold mb-2">Variations</h4>
            <p className="text-xs text-zinc-400 mb-4">Add available options like color or size. Buyers will choose from these during checkout.</p>
            <button className="px-4 py-2 border border-white/20 rounded-full text-xs font-bold hover:bg-white/5 transition text-white">Add variations</button>
          </div>
        </Section>
      </div>

      {/* 5. PRICING & SHIPPING */}
      <div ref={pricingShippingRef}>
        <Section title="Pricing & Inventory">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-bold text-zinc-300 mb-2">Price *</label>
              <div className="relative">
                <span className="absolute left-4 top-3.5 text-zinc-500">$</span>
                <input type="number" step="0.01" name="price" value={formData.price} onChange={handleChange} className="w-full bg-black/40 border border-white/10 rounded-xl pl-8 pr-4 py-3 text-white focus:outline-none focus:border-sky-500 transition" placeholder="0.00" required />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-zinc-300 mb-2">Quantity *</label>
              <input type="number" name="quantity" value={formData.quantity} onChange={handleChange} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500 transition" min="1" max="999" required />
            </div>
          </div>
        </Section>
        <Section title="Shipping">
          <div>
            <label className="block text-sm font-bold text-zinc-300 mb-2">Shipping Profile</label>
            <select name="shipping_profile_id" value={formData.shipping_profile_id} onChange={handleChange} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500 transition appearance-none">
              {shippingProfiles.map(p => (
                <option key={p.shipping_profile_id} value={p.shipping_profile_id.toString()}>{p.title}</option>
              ))}
              {shippingProfiles.length === 0 && <option value="">Profiller Yükleniyor...</option>}
            </select>
          </div>
        </Section>
      </div>

      {/* FOOTER */}
      <div className="fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-white/10 p-4 flex justify-between items-center z-50">
        <p className="text-zinc-500 text-sm ml-4">You have no unsaved changes</p>
        <div className="flex gap-4 mr-4">
          <button className="px-6 py-2.5 bg-zinc-800 text-white font-bold rounded-full hover:bg-zinc-700 transition">Preview</button>
          <button onClick={handlePublish} disabled={isSubmitting} className="px-6 py-2.5 bg-black text-white font-bold rounded-full hover:bg-zinc-800 transition shadow-xl border border-white/20 disabled:opacity-50">
            {isSubmitting ? 'Kaydediliyor...' : 'TASLAK OLARAK YÜKLE'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UploadProductPage;
