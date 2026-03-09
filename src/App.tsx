import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Scissors, Calendar, Clock, User, Phone, CheckCircle2, MapPin, Sun, Moon } from 'lucide-react';

const MASTERS = [
  { id: 'aydis', name: 'Айдыс', role: 'Топ-мастер', categories: ['mens', 'womens', 'coloring'] },
  { id: 'kezhik', name: 'Кежик', role: 'Барбер', categories: ['mens'] },
  { id: 'aydemir', name: 'Айдемир', role: 'Барбер', categories: ['mens'] },
  { id: 'mengi', name: 'Менги', role: 'Барбер', categories: ['mens'] },
  { id: 'taymira', name: 'Таймира', role: 'Мастер-универсал', categories: ['mens', 'womens'] },
];

const SERVICES = {
  mens: [
    { name: 'Модельная', price: '600р' },
    { name: 'Спортивная', price: '500р' },
    { name: 'Фейд', price: '600р' },
    { name: 'Кроп', price: '600р' },
    { name: 'Борода', price: '400р' },
    { name: 'Камуфляж', price: '600р' },
    { name: 'Детская', price: '500р' },
    { name: 'Я скажу потом', price: '—' },
  ],
  womens: [
    { name: 'Модельная', price: '700р' },
    { name: 'Каре', price: '1000р' },
    { name: 'Каскад', price: '1500р' },
    { name: 'Подравнивание', price: '500р' },
    { name: 'Лесенка', price: '1500р' },
    { name: 'Челка', price: 'от 200р' },
    { name: 'Я скажу потом', price: '—' },
  ],
  coloring: [
    { name: 'Тонирование', price: 'от 2000р' },
    { name: 'Мелирование', price: 'от 4000р' },
    { name: 'С техникой', price: 'от 5000р' },
    { name: 'Блондирование', price: 'от 4000р' },
    { name: 'С вашей краской', price: 'от 1500р' },
    { name: 'Я скажу потом', price: '—' },
  ]
};

const CATEGORIES = [
  { id: 'mens', label: 'Мужские' },
  { id: 'womens', label: 'Женские' },
  { id: 'coloring', label: 'Окрашивание' },
];

const BOT_TOKEN = '8554220314:AAF8_c4YHusge0qbTBABjL8wFHXjvq47nPQ';
const CHAT_IDS = ['5446101221', '-1003875610354'];

export default function App() {
  const [activeTab, setActiveTab] = useState('mens');
  const [isDark, setIsDark] = useState(true);
  
  // Form State
  const [category, setCategory] = useState('mens');
  const [service, setService] = useState('');
  const [master, setMaster] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Reset dependent fields when category changes
  useEffect(() => {
    setService('');
    setMaster('');
  }, [category]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.startsWith('7') || val.startsWith('8')) {
      val = val.slice(1);
    }
    let formatted = '+7';
    if (val.length > 0) formatted += ` (${val.substring(0, 3)}`;
    if (val.length >= 4) formatted += `) ${val.substring(3, 6)}`;
    if (val.length >= 7) formatted += `-${val.substring(6, 8)}`;
    if (val.length >= 9) formatted += `-${val.substring(8, 10)}`;
    setPhone(formatted);
  };

  const scrollToBooking = () => {
    document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleMasterClick = (masterId: string) => {
    setMaster(masterId);
    const masterData = MASTERS.find(m => m.id === masterId);
    if (masterData && !masterData.categories.includes(category)) {
      setCategory(masterData.categories[0]);
    }
    scrollToBooking();
  };

  const handleServiceClick = (serviceName: string, categoryId: string) => {
    setCategory(categoryId);
    setService(serviceName);
    scrollToBooking();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const selectedCategory = CATEGORIES.find(c => c.id === category)?.label;
    const selectedMaster = MASTERS.find(m => m.id === master)?.name;

    const message = `
🔥 <b>Новая запись!</b>
    
👤 <b>Имя:</b> ${name}
📞 <b>Телефон:</b> ${phone}
📅 <b>Дата:</b> ${date}
⏰ <b>Время:</b> ${time}

✂️ <b>Категория:</b> ${selectedCategory}
💈 <b>Услуга:</b> ${service}
👨‍🎨 <b>Мастер:</b> ${selectedMaster}
    `;

    try {
      const promises = CHAT_IDS.map(chatId => 
        fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
        })
      );
      await Promise.all(promises);
      
      setIsSuccess(true);
      setCategory('mens');
      setService('');
      setMaster('');
      setDate('');
      setTime('');
      setName('');
      setPhone('');
      
      setTimeout(() => {
        setIsSuccess(false);
      }, 5000);
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Произошла ошибка при отправке. Пожалуйста, попробуйте позже.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const availableMasters = MASTERS.filter(m => m.categories.includes(category));
  const availableServices = SERVICES[category as keyof typeof SERVICES];

  return (
    <div className="min-h-screen font-sans bg-bg-main text-text-main selection:bg-orange-500/30 transition-colors duration-300">
      
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-glass backdrop-blur-xl transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="text-2xl font-black tracking-tighter text-orange-500">
            ВАЙБ.
          </div>
          <div className="flex items-center gap-4 sm:gap-6">
            <a href="tel:+79991792895" className="hidden sm:flex items-center gap-2 text-text-subtle hover:text-text-main transition-colors font-medium">
              <Phone className="w-4 h-4 text-orange-500" />
              <span>+7 (999) 179-28-95</span>
            </a>
            <button
              onClick={() => setIsDark(!isDark)}
              className="p-2.5 bg-surface hover:bg-surface-hover border border-border rounded-full text-text-main transition-colors"
              aria-label="Toggle theme"
            >
              {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button 
              onClick={scrollToBooking}
              className="px-6 py-2.5 bg-surface hover:bg-surface-hover border border-border rounded-full text-sm font-medium transition-colors"
            >
              Записаться
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
          {/* Blurred Blob */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-orange-500/15 rounded-full blur-[150px] pointer-events-none" />
          <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-red-500/10 rounded-full blur-[100px] pointer-events-none" />
          
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="inline-block mb-8 px-5 py-2 rounded-full border border-orange-500/30 bg-orange-500/10 text-orange-500 text-sm font-semibold tracking-widest"
            >
              ОНЛАЙН-ЗАПИСЬ ОТКРЫТА
            </motion.div>
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-tighter leading-[0.9] uppercase"
            >
              Точная стрижка. <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-red-500">
                Уверенный
              </span>
              <br />вайб.
            </motion.h1>
            
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="mt-8 text-lg sm:text-xl text-text-muted max-w-2xl mx-auto font-medium"
            >
              Качественная работа, внимание к деталям и атмосфера, в которую хочется возвращаться.
            </motion.p>
            
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.4 }}
              className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-6"
            >
              <button 
                onClick={scrollToBooking}
                className="px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-full text-lg font-bold transition-all shadow-[0_0_40px_-10px_rgba(249,115,22,0.5)] hover:shadow-[0_0_60px_-15px_rgba(249,115,22,0.6)] hover:scale-105"
              >
                Записаться онлайн
              </button>
              <div className="flex items-center gap-4 text-text-subtle hover:text-text-main transition-colors">
                <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center border border-border">
                  <Phone className="w-5 h-5 text-orange-500" />
                </div>
                <div className="text-left">
                  <div className="text-sm text-text-muted">Или по телефону</div>
                  <a href="tel:+79991792895" className="text-lg font-bold tracking-wide">+7 (999) 179-28-95</a>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Masters Section */}
        <section className="py-20 border-t border-border relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center mb-16">
              <h2 className="text-4xl sm:text-5xl font-black tracking-tighter uppercase mb-4">Наши Мастера</h2>
              <div className="w-24 h-1 bg-gradient-to-r from-orange-500 to-red-500 rounded-full" />
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {MASTERS.map((master, idx) => (
                <motion.div
                  key={master.id}
                  onClick={() => handleMasterClick(master.id)}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.1 }}
                  className="group relative rounded-3xl p-8 bg-surface border border-border hover:border-orange-500/50 transition-all duration-500 hover:bg-surface-hover overflow-hidden cursor-pointer"
                >
                  <div className="absolute -right-10 -top-10 w-40 h-40 bg-orange-500/10 rounded-full blur-[40px] group-hover:bg-orange-500/30 transition-colors duration-500" />
                  
                  <div className="relative z-10 flex items-start justify-between">
                    <div>
                      <div className="text-6xl font-black text-watermark mb-4 group-hover:text-orange-500/10 transition-colors duration-500">
                        {master.name.charAt(0)}
                      </div>
                      <h3 className="text-2xl font-bold mb-1 group-hover:text-orange-500 transition-colors">{master.name}</h3>
                      <p className="text-text-muted font-medium">{master.role}</p>
                    </div>
                    <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center border border-border group-hover:border-orange-500/50 group-hover:bg-orange-500/10 transition-all duration-500 group-hover:scale-110 group-hover:rotate-12">
                      <Scissors className="w-5 h-5 text-text-muted group-hover:text-orange-500 transition-colors duration-500" />
                    </div>
                  </div>
                  
                  <div className="mt-12 flex flex-wrap gap-2 relative z-10">
                    {master.categories.map(cat => (
                      <span key={cat} className="text-xs px-3 py-1.5 rounded-full bg-badge border border-border-light text-text-muted group-hover:border-border transition-colors">
                        {CATEGORIES.find(c => c.id === cat)?.label}
                      </span>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Services Section */}
        <section className="py-20 border-t border-border relative bg-surface">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center mb-12">
              <h2 className="text-4xl sm:text-5xl font-black tracking-tighter uppercase mb-4">Услуги и Цены</h2>
              <div className="w-24 h-1 bg-gradient-to-r from-orange-500 to-red-500 rounded-full" />
            </div>

            {/* Tabs */}
            <div className="flex overflow-x-auto no-scrollbar gap-2 p-1 bg-surface rounded-2xl mb-8 border border-border">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveTab(cat.id)}
                  className={`flex-1 min-w-[120px] py-3 px-4 rounded-xl text-sm font-medium transition-all ${
                    activeTab === cat.id 
                      ? 'bg-orange-500 text-white shadow-lg' 
                      : 'text-text-muted hover:text-text-main hover:bg-surface-hover'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Services List */}
            <div className="bg-surface border border-border rounded-3xl p-6 sm:p-8 backdrop-blur-sm">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2"
                >
                  {SERVICES[activeTab as keyof typeof SERVICES].map((service, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => handleServiceClick(service.name, activeTab)}
                      className="flex items-center justify-between group p-3 hover:bg-surface-hover rounded-2xl transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-500/50 group-hover:bg-orange-500 group-hover:scale-150 transition-all" />
                        <span className="text-lg font-medium text-text-subtle group-hover:text-text-main transition-colors">{service.name}</span>
                      </div>
                      <span className="text-lg font-bold text-orange-500 whitespace-nowrap bg-orange-500/10 px-4 py-1 rounded-full">{service.price}</span>
                    </div>
                  ))}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </section>

        {/* Booking Section */}
        <section id="booking" className="py-20 border-t border-border relative">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center mb-12">
              <h2 className="text-4xl sm:text-5xl font-black tracking-tighter uppercase mb-4">Оформить запись</h2>
              <div className="w-24 h-1 bg-gradient-to-r from-orange-500 to-red-500 rounded-full" />
            </div>

            <div className="bg-surface border border-border rounded-3xl p-6 sm:p-10 backdrop-blur-md relative overflow-hidden">
              <AnimatePresence>
                {isSuccess && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-10 bg-bg-main/95 backdrop-blur-xl flex flex-col items-center justify-center text-center p-8"
                  >
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", delay: 0.1 }}
                    >
                      <CheckCircle2 className="w-20 h-20 text-orange-500 mb-6" />
                    </motion.div>
                    <h3 className="text-3xl font-black tracking-tighter mb-2">ВЫ УСПЕШНО ЗАПИСАНЫ</h3>
                    <p className="text-text-muted">Мы ждем вас в назначенное время. До встречи в ВАЙБ.</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Category */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-muted flex items-center gap-2">
                      <Scissors className="w-4 h-4" /> Категория
                    </label>
                    <select 
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-text-main focus:outline-none focus:border-orange-500 focus:bg-surface-hover focus:ring-4 focus:ring-orange-500/10 transition-all appearance-none"
                      required
                    >
                      {CATEGORIES.map(cat => (
                        <option key={cat.id} value={cat.id} className="bg-dropdown text-text-main">{cat.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Service */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-muted flex items-center gap-2">
                      <Scissors className="w-4 h-4" /> Услуга
                    </label>
                    <select 
                      value={service}
                      onChange={(e) => setService(e.target.value)}
                      className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-text-main focus:outline-none focus:border-orange-500 focus:bg-surface-hover focus:ring-4 focus:ring-orange-500/10 transition-all appearance-none"
                      required
                    >
                      <option value="" disabled className="bg-dropdown text-text-main">Выберите услугу</option>
                      {availableServices.map((srv, idx) => (
                        <option key={idx} value={srv.name} className="bg-dropdown text-text-main">{srv.name} - {srv.price}</option>
                      ))}
                    </select>
                  </div>

                  {/* Master */}
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium text-text-muted flex items-center gap-2">
                      <User className="w-4 h-4" /> Мастер
                    </label>
                    <select 
                      value={master}
                      onChange={(e) => setMaster(e.target.value)}
                      className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-text-main focus:outline-none focus:border-orange-500 focus:bg-surface-hover focus:ring-4 focus:ring-orange-500/10 transition-all appearance-none"
                      required
                    >
                      <option value="" disabled className="bg-dropdown text-text-main">Выберите мастера</option>
                      {availableMasters.map(m => (
                        <option key={m.id} value={m.id} className="bg-dropdown text-text-main">{m.name} ({m.role})</option>
                      ))}
                    </select>
                  </div>

                  {/* Date */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-muted flex items-center gap-2">
                      <Calendar className="w-4 h-4" /> Дата
                    </label>
                    <input 
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-text-main focus:outline-none focus:border-orange-500 focus:bg-surface-hover focus:ring-4 focus:ring-orange-500/10 transition-all [color-scheme:light] dark:[color-scheme:dark]"
                      required
                    />
                  </div>

                  {/* Time */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-muted flex items-center gap-2">
                      <Clock className="w-4 h-4" /> Время
                    </label>
                    <input 
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-text-main focus:outline-none focus:border-orange-500 focus:bg-surface-hover focus:ring-4 focus:ring-orange-500/10 transition-all [color-scheme:light] dark:[color-scheme:dark]"
                      required
                    />
                  </div>

                  {/* Name */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-muted flex items-center gap-2">
                      <User className="w-4 h-4" /> Ваше Имя
                    </label>
                    <input 
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Иван Иванов"
                      className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-text-main placeholder:text-text-muted/50 focus:outline-none focus:border-orange-500 focus:bg-surface-hover focus:ring-4 focus:ring-orange-500/10 transition-all"
                      required
                    />
                  </div>

                  {/* Phone */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-muted flex items-center gap-2">
                      <Phone className="w-4 h-4" /> Телефон
                    </label>
                    <input 
                      type="tel"
                      value={phone}
                      onChange={handlePhoneChange}
                      placeholder="+7 (999) 000-00-00"
                      className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-text-main placeholder:text-text-muted/50 focus:outline-none focus:border-orange-500 focus:bg-surface-hover focus:ring-4 focus:ring-orange-500/10 transition-all"
                      required
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/50 disabled:cursor-not-allowed text-white rounded-xl text-lg font-bold transition-all shadow-[0_0_20px_-5px_rgba(249,115,22,0.4)] hover:shadow-[0_0_30px_-5px_rgba(249,115,22,0.6)] mt-8"
                >
                  {isSubmitting ? 'Отправка...' : 'Подтвердить запись'}
                </button>
              </form>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-bg-main py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
            <div>
              <div className="text-3xl font-black tracking-tighter text-orange-500 mb-4">
                ВАЙБ.
              </div>
              <p className="text-text-muted text-sm max-w-xs">
                Мы верим, что хорошая прическа — это не просто стрижка, это уверенность в себе и правильный настрой на весь день.
              </p>
            </div>
            
            <div className="flex flex-col gap-4 md:items-center">
              <div className="flex items-center gap-3 text-text-subtle">
                <Phone className="w-5 h-5 text-orange-500" />
                <a href="tel:+79991792895" className="hover:text-text-main transition-colors">+7 (999) 179-28-95</a>
              </div>
              <div className="flex items-center gap-3 text-text-subtle">
                <MapPin className="w-5 h-5 text-orange-500" />
                <span>ТД '5 Звёзд' 1 этаж, г. Кызыл</span>
              </div>
              <div className="flex items-center gap-3 text-text-subtle">
                <Clock className="w-5 h-5 text-orange-500" />
                <span>Ежедневно 09:00 — 19:00</span>
              </div>
            </div>

            <div className="md:text-right">
              <button 
                onClick={scrollToBooking}
                className="px-6 py-3 bg-surface hover:bg-surface-hover border border-border rounded-xl text-sm font-medium transition-colors"
              >
                Записаться онлайн
              </button>
            </div>
          </div>
          
          <div className="mt-12 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between text-xs text-text-muted">
            <p>© {new Date().getFullYear()} ВАЙБ. Все права защищены.</p>
            <p className="mt-2 sm:mt-0">Разработано с душой</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
