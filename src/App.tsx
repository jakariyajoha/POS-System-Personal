import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, ArrowUpRight, ArrowDownRight, Wallet, Filter, LayoutGrid, Calendar, ArrowUpDown, TrendingUp, Settings, Download, Trash2, X, Search, Check, ChevronDown, LogOut, User as UserIcon, Menu, Sparkles, CreditCard } from 'lucide-react';
import { Transaction, TransactionType, CategoryDefinition, TimeRange, Loan, LoanType, LoanPayment } from './types';
import { ICON_MAP, INITIAL_CATEGORIES, INITIAL_TRANSACTIONS } from './constants';
import { formatCurrency, cn, exportToCSV } from './lib/utils';
import { TransactionItem } from './components/TransactionItem';
import { Reports } from './components/Reports';
import { AddTransactionModal } from './components/AddTransactionModal';
import { CategoryManager } from './components/CategoryManager';
import { LoanManager } from './components/LoanManager';
import { supabase, testSupabaseConnection } from './lib/supabase';
import { Auth } from './components/Auth';
import { Session } from '@supabase/supabase-js';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ username: string } | null>(null);
  const [connTest, setConnTest] = useState<{ status: 'idle' | 'testing' | 'success' | 'error', message?: string }>({ status: 'idle' });
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const isSupabaseConfigured = useMemo(() => {
    return !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  }, []);

  const LOCAL_SESSION = useMemo(() => ({
    user: {
      id: 'local-guest-user',
      email: 'guest@financely.local'
    }
  }), []);

  const runConnTest = async () => {
    setConnTest({ status: 'testing' });
    const result = await testSupabaseConnection();
    if (result.success) {
      setConnTest({ status: 'success', message: 'Connection successful!' });
    } else {
      let msg = result.message;
      if (result.diagnostics?.urlHasRestPath) {
        msg = "Error: Your URL includes '/rest/v1'. Please remove that from your VITE_SUPABASE_URL setting.";
      } else if (!result.diagnostics?.urlFormatValid) {
        msg = "Error: Your URL must start with https://";
      }
      setConnTest({ status: 'error', message: msg });
    }
  };

  const [categories, setCategories] = useState<CategoryDefinition[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loanPayments, setLoanPayments] = useState<LoanPayment[]>([]);
  const [isLoanManagerOpen, setIsLoanManagerOpen] = useState(false);
  
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession(LOCAL_SESSION as any);
      setProfile({ username: 'Guest Account' });
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, [isSupabaseConfigured, LOCAL_SESSION]);

  const fetchData = useCallback(async () => {
    if (!session?.user) return;

    if (!isSupabaseConfigured) {
      // LocalStorage mode
      const localCats = localStorage.getItem('financely_categories');
      if (localCats) {
        setCategories(JSON.parse(localCats));
      } else {
        localStorage.setItem('financely_categories', JSON.stringify(INITIAL_CATEGORIES));
        setCategories(INITIAL_CATEGORIES);
      }

      const localTrans = localStorage.getItem('financely_transactions');
      if (localTrans) {
        setTransactions(JSON.parse(localTrans));
      } else {
        localStorage.setItem('financely_transactions', JSON.stringify(INITIAL_TRANSACTIONS));
        setTransactions(INITIAL_TRANSACTIONS);
      }

      const localLoans = localStorage.getItem('financely_loans');
      if (localLoans) {
        setLoans(JSON.parse(localLoans));
      } else {
        setLoans([]);
      }

      const localLP = localStorage.getItem('financely_loan_payments');
      if (localLP) {
        setLoanPayments(JSON.parse(localLP));
      } else {
        setLoanPayments([]);
      }

      setProfile({ username: 'Guest Account' });
      return;
    }

    try {
      // Fetch profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', session.user.id)
        .single();
      
      if (profileData) setProfile(profileData);

      // Fetch categories
      const { data: catData, error: catError } = await supabase
        .from('categories')
        .select('*')
        .order('name');
      
      if (catError) throw catError;
      if (catData) {
        setCategories(catData.map(c => ({
          id: c.id,
          name: c.name,
          iconName: c.icon_name,
          color: c.color
        })));
      }

      // Fetch transactions
      const { data: transData, error: transError } = await supabase
        .from('transactions')
        .select('*')
        .order('date', { ascending: false });
      
      if (transError) throw transError;
      if (transData) setTransactions(transData);

      // Fetch loans
      const { data: loanData, error: loanError } = await supabase
        .from('loans')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (loanError) throw loanError;
      if (loanData) setLoans(loanData);

      // Fetch loan payments
      const { data: lpData, error: lpError } = await supabase
        .from('loan_payments')
        .select('*')
        .order('payment_date', { ascending: false });
      
      if (lpError) throw lpError;
      if (lpData) setLoanPayments(lpData);
    } catch (error: any) {
      console.error('Error fetching data:', error);
      if (error.message === 'Failed to fetch') {
        alert('Connection Error: Could not connect to Supabase. Please check your VITE_SUPABASE_URL format and your internet connection.');
      } else {
        alert('Data Error: ' + error.message);
      }
    }
  }, [session, isSupabaseConfigured]);

  useEffect(() => {
    if (session) {
      fetchData();
    } else {
      setCategories([]);
      setTransactions([]);
      setProfile(null);
    }
  }, [session, fetchData]);

  // History for Undo/Redo (Keep local for now, but sync to DB on major changes)
  const [history, setHistory] = useState<Transaction[][]>([]);
  const [future, setFuture] = useState<Transaction[][]>([]);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  // Advanced Filter/Sort State
  const [filterType, setFilterType] = useState<TransactionType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'category' | 'type'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [listDateRange, setListDateRange] = useState({ start: '', end: '' });
  const [selectedDayLabel, setSelectedDayLabel] = useState<'all' | 'today' | 'yesterday' | 'specific'>('all');
  const [listTimePeriod, setListTimePeriod] = useState<'all' | 'morning' | 'afternoon' | 'evening' | 'night'>('all');

  const [timeRange, setTimeRange] = useState<TimeRange | 'custom'>('month');
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [customRange, setCustomRange] = useState({ 
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], 
    end: new Date().toISOString().split('T')[0] 
  });
  const [reportCategories, setReportCategories] = useState<string[]>([]);
  const [reportTypes, setReportTypes] = useState<TransactionType[]>(['income', 'expense']);
  const [reportSearchQuery, setReportSearchQuery] = useState('');
  const [reportTimeOfDay, setReportTimeOfDay] = useState({ start: '00:00', end: '23:59' });
  const [reportTags, setReportTags] = useState<string[]>([]);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    transactions.forEach(t => {
      if (t.tags) t.tags.forEach(tag => tags.add(tag));
    });
    return Array.from(tags).sort();
  }, [transactions]);

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportDateRange, setExportDateRange] = useState({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  const [isReportSettingsOpen, setIsReportSettingsOpen] = useState(false);

  const saveToHistory = (newTransactions: Transaction[]) => {
    setHistory(prev => [...prev, transactions].slice(-20)); // Keep last 20 actions
    setFuture([]);
    setTransactions(newTransactions);
  };

  const undo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    const newHistory = history.slice(0, history.length - 1);
    setFuture(prev => [transactions, ...prev]);
    setHistory(newHistory);
    setTransactions(previous);
    setLastAction('Undone');
    setTimeout(() => setLastAction(null), 2000);
  };

  const redo = () => {
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);
    setHistory(prev => [...prev, transactions]);
    setFuture(newFuture);
    setTransactions(next);
    setLastAction('Redone');
    setTimeout(() => setLastAction(null), 2000);
  };

  const stats = useMemo(() => {
    const income = transactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
    const expenses = transactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
    return {
      balance: income - expenses,
      income,
      expenses
    };
  }, [transactions]);

  const carryover = useMemo(() => {
    const selectedMonthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const pastTransactions = transactions.filter(t => new Date(t.date) < selectedMonthStart);
    const pastIncome = pastTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const pastExpenses = pastTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    return pastIncome - pastExpenses;
  }, [transactions, currentMonth]);

  const monthlyStats = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    
    const monthTransactions = transactions.filter(t => {
      const d = new Date(t.date);
      return d.getFullYear() === year && d.getMonth() === month;
    });

    const rawIncome = monthTransactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);

    const expenses = monthTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);

    const borrowedInMonth = monthTransactions
      .filter(t => t.type === 'income' && t.category === 'Loan' && t.note.toLowerCase().includes('borrowed'))
      .reduce((sum, t) => sum + t.amount, 0);

    const repaidInMonth = monthTransactions
      .filter(t => t.type === 'expense' && (t.category === 'Loan Payment' || (t.category === 'Loan' && t.note.toLowerCase().includes('repay'))))
      .reduce((sum, t) => sum + t.amount, 0);

    const carryoverToUse = carryover > 0 ? carryover : 0;

    const income = rawIncome + carryoverToUse;

    return {
      income,
      expenses,
      balance: income - expenses,
      rawIncome,
      borrowedInMonth,
      carryoverToUse,
      repaidInMonth
    };
  }, [transactions, currentMonth, carryover]);

  const filteredTransactions = useMemo(() => {
    const filtered = transactions
      .filter(t => {
        const matchesType = filterType === 'all' || t.type === filterType;
        const matchesQuery = t.note.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            t.category.toLowerCase().includes(searchQuery.toLowerCase());
        
        const transactionDate = new Date(t.date);
        let matchesDate = true;

        if (selectedDayLabel === 'today') {
          const today = new Date();
          matchesDate = transactionDate.getDate() === today.getDate() &&
                       transactionDate.getMonth() === today.getMonth() &&
                       transactionDate.getFullYear() === today.getFullYear();
        } else if (selectedDayLabel === 'yesterday') {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          matchesDate = transactionDate.getDate() === yesterday.getDate() &&
                       transactionDate.getMonth() === yesterday.getMonth() &&
                       transactionDate.getFullYear() === yesterday.getFullYear();
        } else if (selectedDayLabel === 'specific' && listDateRange.start) {
          const specific = new Date(listDateRange.start);
          matchesDate = transactionDate.getDate() === specific.getDate() &&
                       transactionDate.getMonth() === specific.getMonth() &&
                       transactionDate.getFullYear() === specific.getFullYear();
        } else if (listDateRange.start || listDateRange.end) {
          matchesDate = (!listDateRange.start || transactionDate >= new Date(listDateRange.start)) &&
                        (!listDateRange.end || transactionDate <= new Date(listDateRange.end));
        } else {
          // Default: filter by the currently selected viewing period's month and year
          matchesDate = transactionDate.getFullYear() === currentMonth.getFullYear() &&
                        transactionDate.getMonth() === currentMonth.getMonth();
        }
        
        const hour = transactionDate.getHours();
        let matchesTimePeriod = true;
        if (listTimePeriod === 'morning') matchesTimePeriod = hour >= 5 && hour < 12;
        else if (listTimePeriod === 'afternoon') matchesTimePeriod = hour >= 12 && hour < 17;
        else if (listTimePeriod === 'evening') matchesTimePeriod = hour >= 17 && hour < 21;
        else if (listTimePeriod === 'night') matchesTimePeriod = hour >= 21 || hour < 5;

        return matchesType && matchesQuery && matchesDate && matchesTimePeriod;
      });

    // Create virtual carryover transaction for visual feedback in lists
    const virtualCarryover: Transaction[] = [];
    if (carryover > 0) {
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth();
      const carryoverDateObj = new Date(year, month, 1, 0, 0, 0);
      const carryoverDateStr = carryoverDateObj.toISOString();

      const matchesType = filterType === 'all' || filterType === 'income';
      const matchesQuery = searchQuery === '' || 
                           'carried over from last month'.includes(searchQuery.toLowerCase()) ||
                           'carryover'.includes(searchQuery.toLowerCase());
      
      let matchesDate = true;
      if (selectedDayLabel === 'today') {
        const today = new Date();
        matchesDate = carryoverDateObj.getDate() === today.getDate() &&
                     carryoverDateObj.getMonth() === today.getMonth() &&
                     carryoverDateObj.getFullYear() === today.getFullYear();
      } else if (selectedDayLabel === 'yesterday') {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        matchesDate = carryoverDateObj.getDate() === yesterday.getDate() &&
                     carryoverDateObj.getMonth() === yesterday.getMonth() &&
                     carryoverDateObj.getFullYear() === yesterday.getFullYear();
      } else if (selectedDayLabel === 'specific' && listDateRange.start) {
        const specific = new Date(listDateRange.start);
        matchesDate = carryoverDateObj.getDate() === specific.getDate() &&
                     carryoverDateObj.getMonth() === specific.getMonth() &&
                     carryoverDateObj.getFullYear() === specific.getFullYear();
      } else {
        matchesDate = (!listDateRange.start || carryoverDateObj >= new Date(listDateRange.start)) &&
                      (!listDateRange.end || carryoverDateObj <= new Date(listDateRange.end));
      }

      if (matchesType && matchesQuery && matchesDate) {
        virtualCarryover.push({
          id: 'virtual-carryover-id',
          amount: carryover,
          type: 'income',
          category: 'Carryover',
          note: 'Carried over from last month',
          tags: ['CarriedOver'],
          date: carryoverDateStr,
          isVirtualCarryover: true
        });
      }
    }

    const combined = [...virtualCarryover, ...filtered];

    return combined.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'date') {
        comparison = new Date(b.date).getTime() - new Date(a.date).getTime();
      } else if (sortBy === 'amount') {
        comparison = b.amount - a.amount;
      } else if (sortBy === 'category') {
        comparison = a.category.localeCompare(b.category);
      } else if (sortBy === 'type') {
        comparison = a.type.localeCompare(b.type);
      }
      return sortOrder === 'desc' ? comparison : -comparison;
    });
  }, [transactions, filterType, sortBy, sortOrder, searchQuery, listDateRange, selectedDayLabel, listTimePeriod, carryover, currentMonth]);

  const filteredStats = useMemo(() => {
    const income = filteredTransactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
    const expenses = filteredTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
    return {
      balance: income - expenses,
      income,
      expenses,
      count: filteredTransactions.length
    };
  }, [filteredTransactions]);

  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  const addTransaction = async (data: Omit<Transaction, 'id'>) => {
    if (!session?.user) return;
    
    if (!isSupabaseConfigured) {
      const newTrans: Transaction = {
        ...data,
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
      };
      const updated = [newTrans, ...transactions];
      setTransactions(updated);
      localStorage.setItem('financely_transactions', JSON.stringify(updated));
      return;
    }

    const { data: newTrans, error } = await supabase
      .from('transactions')
      .insert({
        ...data,
        user_id: session.user.id,
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error adding transaction:', error);
      return;
    }
    setTransactions(prev => [newTrans, ...prev]);
  };

  const updateTransaction = async (updated: Transaction) => {
    if (!session?.user) return;

    if (!isSupabaseConfigured) {
      const updatedList = transactions.map(t => t.id === updated.id ? updated : t);
      setTransactions(updatedList);
      localStorage.setItem('financely_transactions', JSON.stringify(updatedList));
      setEditingTransaction(null);
      return;
    }

    const { error } = await supabase
      .from('transactions')
      .update(updated)
      .eq('id', updated.id);
    
    if (error) {
      console.error('Error updating transaction:', error);
      return;
    }
    setTransactions(prev => prev.map(t => t.id === updated.id ? updated : t));
    setEditingTransaction(null);
  };

  const deleteTransaction = async (id: string) => {
    if (!session?.user) return;

    if (!isSupabaseConfigured) {
      const updatedList = transactions.filter(t => t.id !== id);
      setTransactions(updatedList);
      localStorage.setItem('financely_transactions', JSON.stringify(updatedList));
      setSelectedIds(prev => prev.filter(selectedId => selectedId !== id));
      return;
    }

    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Error deleting transaction:', error);
      return;
    }
    setTransactions(prev => prev.filter(t => t.id !== id));
    setSelectedIds(prev => prev.filter(selectedId => selectedId !== id));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const bulkDelete = async () => {
    if (!session?.user) return;
    if (confirm(`Delete ${selectedIds.length} transactions?`)) {
      if (!isSupabaseConfigured) {
        const updatedList = transactions.filter(t => !selectedIds.includes(t.id));
        setTransactions(updatedList);
        localStorage.setItem('financely_transactions', JSON.stringify(updatedList));
        setSelectedIds([]);
        setLastAction('Bulk Deleted');
        setTimeout(() => setLastAction(null), 2000);
        return;
      }

      const { error } = await supabase
        .from('transactions')
        .delete()
        .in('id', selectedIds);
      
      if (error) {
        console.error('Error bulk deleting:', error);
        return;
      }
      setTransactions(prev => prev.filter(t => !selectedIds.includes(t.id)));
      setSelectedIds([]);
      setLastAction('Bulk Deleted');
      setTimeout(() => setLastAction(null), 2000);
    }
  };

  const bulkCategorize = async (categoryName: string) => {
    if (!session?.user) return;

    if (!isSupabaseConfigured) {
      const updatedList = transactions.map(t => 
        selectedIds.includes(t.id) ? { ...t, category: categoryName } : t
      );
      setTransactions(updatedList);
      localStorage.setItem('financely_transactions', JSON.stringify(updatedList));
      setSelectedIds([]);
      setLastAction('Bulk Categorized');
      setTimeout(() => setLastAction(null), 2000);
      return;
    }

    const { error } = await supabase
      .from('transactions')
      .update({ category: categoryName })
      .in('id', selectedIds);
    
    if (error) {
      console.error('Error bulk categorizing:', error);
      return;
    }
    setTransactions(prev => prev.map(t => 
      selectedIds.includes(t.id) ? { ...t, category: categoryName } : t
    ));
    setSelectedIds([]);
    setLastAction('Bulk Categorized');
    setTimeout(() => setLastAction(null), 2000);
  };

  const addCategory = async (data: Omit<CategoryDefinition, 'id'>) => {
    if (!session?.user) return;

    if (!isSupabaseConfigured) {
      const newCat: CategoryDefinition = {
        ...data,
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
      };
      const updatedList = [...categories, newCat];
      setCategories(updatedList);
      localStorage.setItem('financely_categories', JSON.stringify(updatedList));
      return;
    }

    const { data: newCat, error } = await supabase
      .from('categories')
      .insert({
        name: data.name,
        icon_name: data.iconName,
        color: data.color,
        user_id: session.user.id
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error adding category:', error);
      alert('Error adding category: ' + error.message);
      return;
    }
    setCategories(prev => [...prev, {
      id: newCat.id,
      name: newCat.name,
      iconName: newCat.icon_name,
      color: newCat.color
    }]);
  };

  const updateCategory = async (cat: CategoryDefinition) => {
    if (!session?.user) return;

    if (!isSupabaseConfigured) {
      const updatedList = categories.map(c => c.id === cat.id ? cat : c);
      setCategories(updatedList);
      localStorage.setItem('financely_categories', JSON.stringify(updatedList));
      return;
    }

    const { error } = await supabase
      .from('categories')
      .update({
        name: cat.name,
        icon_name: cat.iconName,
        color: cat.color
      })
      .eq('id', cat.id);
    
    if (error) {
      console.error('Error updating category:', error);
      alert('Error updating category: ' + error.message);
      return;
    }
    setCategories(prev => prev.map(c => c.id === cat.id ? cat : c));
  };

  const deleteCategory = async (id: string) => {
    if (!session?.user) return;

    if (!isSupabaseConfigured) {
      const updatedList = categories.filter(c => c.id !== id);
      setCategories(updatedList);
      localStorage.setItem('financely_categories', JSON.stringify(updatedList));
      return;
    }

    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Error deleting category:', error);
      return;
    }
    setCategories(prev => prev.filter(c => c.id !== id));
  };

  const addLoan = async (data: any) => {
    if (!session?.user) return;

    if (!isSupabaseConfigured) {
      const newLoan: Loan = {
        ...data,
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
        user_id: session.user.id,
        remaining_amount: data.amount,
        status: 'active',
        created_at: new Date().toISOString()
      };
      
      const updatedLoans = [newLoan, ...loans];
      setLoans(updatedLoans);
      localStorage.setItem('financely_loans', JSON.stringify(updatedLoans));
      
      await addTransaction({
        amount: data.amount,
        type: data.type === 'lend' ? 'expense' : 'income',
        category: 'Loan',
        note: `${data.type === 'lend' ? 'Lent to' : 'Borrowed from'} ${data.person_name}`,
        date: new Date().toISOString()
      });

      setLastAction('Loan record & transaction added');
      setTimeout(() => setLastAction(null), 2000);
      return;
    }

    const { data: newLoan, error } = await supabase
      .from('loans')
      .insert({
        ...data,
        user_id: session.user.id,
        remaining_amount: data.amount,
        status: 'active'
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error adding loan:', error);
      return;
    }
    if (newLoan) {
      setLoans(prev => [newLoan, ...prev]);
      
      // Phase 2: Create a standard transaction
      // Lending money is an Expense (money left your pocket)
      // Borrowing money is Income (money entered your pocket)
      await addTransaction({
        amount: data.amount,
        type: data.type === 'lend' ? 'expense' : 'income',
        category: 'Loan',
        note: `${data.type === 'lend' ? 'Lent to' : 'Borrowed from'} ${data.person_name}`,
        date: new Date().toISOString()
      });

      setLastAction('Loan record & transaction added');
      setTimeout(() => setLastAction(null), 2000);
    }
  };

  const recordLoanPayment = async (loanId: string, amount: number, note?: string) => {
    if (!session?.user) return;

    if (!isSupabaseConfigured) {
      const newPayment: LoanPayment = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
        loan_id: loanId,
        user_id: session.user.id,
        amount,
        note: note || '',
        payment_date: new Date().toISOString()
      };

      const updatedPayments = [newPayment, ...loanPayments];
      setLoanPayments(updatedPayments);
      localStorage.setItem('financely_loan_payments', JSON.stringify(updatedPayments));

      const loan = loans.find(l => l.id === loanId);
      if (!loan) return;

      const newRemaining = Math.max(0, loan.remaining_amount - amount);
      const newStatus = newRemaining === 0 ? 'completed' : 'active';

      const updatedLoan = {
        ...loan,
        remaining_amount: newRemaining,
        status: newStatus as 'active' | 'completed'
      };

      const updatedLoans = loans.map(l => l.id === loanId ? updatedLoan : l);
      setLoans(updatedLoans);
      localStorage.setItem('financely_loans', JSON.stringify(updatedLoans));

      await addTransaction({
        amount,
        type: loan.type === 'lend' ? 'income' : 'expense',
        category: 'Loan Payment',
        note: note || `Loan payment from/to ${loan.person_name}`,
        date: new Date().toISOString()
      });

      setLastAction('Payment recorded');
      setTimeout(() => setLastAction(null), 2000);
      return;
    }
    
    try {
      // 1. Record the payment in loan_payments
      const { error: pError } = await supabase
        .from('loan_payments')
        .insert({
          loan_id: loanId,
          user_id: session.user.id,
          amount,
          note
        });
      if (pError) throw pError;

      // 2. Fetch current loan to calculate new remaining_amount
      const loan = loans.find(l => l.id === loanId);
      if (!loan) return;

      const newRemaining = Math.max(0, loan.remaining_amount - amount);
      const newStatus = newRemaining === 0 ? 'completed' : 'active';

      // 3. Update the loan
      const { data: updatedLoan, error: uError } = await supabase
        .from('loans')
        .update({
          remaining_amount: newRemaining,
          status: newStatus
        })
        .eq('id', loanId)
        .select()
        .single();
      if (uError) throw uError;

      if (updatedLoan) {
        setLoans(prev => prev.map(l => l.id === loanId ? updatedLoan : l));
        
        // Refresh payments
        const { data: lpData } = await supabase
          .from('loan_payments')
          .select('*')
          .eq('loan_id', loanId)
          .order('payment_date', { ascending: false });
        if (lpData) {
          setLoanPayments(prev => [
            ...lpData,
            ...prev.filter(p => p.loan_id !== loanId)
          ]);
        }
        
        // 4. Also record as a regular transaction if you want it to reflect in balance
        // Lending back (receiving money) is income, Paying debt is expense
        await addTransaction({
          amount,
          type: loan.type === 'lend' ? 'income' : 'expense',
          category: 'Loan Payment',
          note: note || `Loan payment from/to ${loan.person_name}`,
          date: new Date().toISOString()
        });

        setLastAction('Payment recorded');
        setTimeout(() => setLastAction(null), 2000);
      }
    } catch (err) {
      console.error('Error recording payment:', err);
    }
  };

  const deleteLoan = async (id: string) => {
    if (!session?.user) return;

    if (!isSupabaseConfigured) {
      const updatedLoans = loans.filter(l => l.id !== id);
      setLoans(updatedLoans);
      localStorage.setItem('financely_loans', JSON.stringify(updatedLoans));
      return;
    }

    const { error } = await supabase.from('loans').delete().eq('id', id);
    if (error) {
      console.error('Error deleting loan:', error);
      return;
    }
    setLoans(prev => prev.filter(l => l.id !== id));
  };

  const handleExport = () => {
    const start = new Date(exportDateRange.start);
    const end = new Date(exportDateRange.end);
    end.setHours(23, 59, 59, 999);

    const exportData = transactions
      .filter(t => {
        const d = new Date(t.date);
        return d >= start && d <= end;
      })
      .map(({ id, ...rest }) => ({
        ...rest,
        date: new Date(rest.date).toLocaleString(undefined, { timeZone: 'Asia/Dhaka' })
      }));
    
    if (exportData.length === 0) {
      alert('No transactions found in this date range');
      return;
    }

    exportToCSV(exportData, `jj_transactions_${exportDateRange.start}_to_${exportDateRange.end}`);
    setIsExportModalOpen(false);
  };

  useEffect(() => {
    const handleOpen = () => setShowDiagnostics(true);
    window.addEventListener('open-diagnostics', handleOpen);
    return () => window.removeEventListener('open-diagnostics', handleOpen);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F2F2F7]">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-4 border-[#007AFF] border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (showDiagnostics) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F2F2F7] p-6">
        <div className="glass-card bg-white rounded-[2.5rem] p-10 max-w-md text-center shadow-2xl border border-white relative">
          <button 
            onClick={() => setShowDiagnostics(false)}
            className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full text-gray-500 hover:bg-gray-200 transition-colors"
          >
            <X size={20} />
          </button>
          <div className="w-16 h-16 bg-blue-50 text-[#007AFF] rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Settings size={32} />
          </div>
          <h2 className="text-2xl font-bold text-[#1C1C1E] mb-4">
            Connection Diagnostics
          </h2>
          <p className="text-[#8E8E93] text-sm leading-relaxed mb-8">
            Please verify your Supabase credentials in the <strong>Settings</strong> menu of AI Studio:
          </p>
          <div className="space-y-3 text-left">
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <code className="text-xs font-bold text-[#1C1C1E]">VITE_SUPABASE_URL</code>
            </div>
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <code className="text-xs font-bold text-[#1C1C1E]">VITE_SUPABASE_ANON_KEY</code>
            </div>
          </div>
          
          <div className="mt-8">
            <button
              onClick={runConnTest}
              disabled={connTest.status === 'testing'}
              className={cn(
                "w-full py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg transition-all",
                connTest.status === 'success' ? "bg-green-500 text-white shadow-green-500/20" :
                connTest.status === 'error' ? "bg-red-500 text-white shadow-red-500/20" :
                "bg-[#007AFF] text-white hover:bg-[#0062CC] shadow-blue-500/20"
              )}
            >
              {connTest.status === 'testing' ? 'Testing...' : 
               connTest.status === 'success' ? 'Connected!' :
               connTest.status === 'error' ? 'Test Failed - Try Again' : 'Test Connection'}
            </button>
            
            {connTest.status === 'error' && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-4 bg-red-50 rounded-2xl border border-red-100 text-left"
              >
                <p className="text-xs font-bold text-red-600 mb-2 uppercase tracking-wider">Troubleshooting Tips:</p>
                <ul className="text-[11px] text-red-500 space-y-1.5 font-medium list-disc ml-3">
                  <li>Check if <strong>VITE_SUPABASE_URL</strong> starts with <code>https://</code></li>
                  <li>Ensure there is <strong>no trailing slash</strong> at the end of the URL.</li>
                  <li>Verify you used the <strong>anon (public)</strong> key, not the service key.</li>
                  <li>Open <strong>Console (F12)</strong> to see the exact error message.</li>
                </ul>
              </motion.div>
            )}

            {connTest.status === 'success' && (
              <p className="mt-3 text-xs font-medium text-green-600">
                {connTest.message}
              </p>
            )}
          </div>

          <p className="text-[11px] text-[#8E8E93] mt-8 font-medium">
            You can find these in your Supabase Project Settings under API.
          </p>
        </div>
      </div>
    );
  }

  if (isSupabaseConfigured && !session) {
    return <Auth />;
  }

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 bottom-0 w-[280px] sm:w-[320px] bg-white z-[70] shadow-2xl flex flex-col p-6"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#007AFF] rounded-2xl flex items-center justify-center text-white">
                    <LayoutGrid size={24} />
                  </div>
                  <h2 className="text-xl font-bold tracking-tight">Financely</h2>
                </div>
                <button 
                  onClick={() => setIsSidebarOpen(false)}
                  className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <nav className="space-y-2 flex-grow">
                {[
                  { label: 'Loan Center', icon: CreditCard, action: () => setIsLoanManagerOpen(true) },
                  { label: 'Upcoming', icon: Sparkles },
                ].map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      if (item.action) item.action();
                      setIsSidebarOpen(false);
                    }}
                    className="w-full flex items-center gap-3 p-3 text-gray-600 hover:bg-blue-50 hover:text-[#007AFF] rounded-2xl font-bold text-sm transition-all group"
                  >
                    <div className="p-2 bg-gray-50 group-hover:bg-blue-100 rounded-xl transition-colors">
                      <item.icon size={18} />
                    </div>
                    {item.label}
                  </button>
                ))}
                {!isSupabaseConfigured && (
                  <button
                    onClick={() => {
                      setShowDiagnostics(true);
                      setIsSidebarOpen(false);
                    }}
                    className="w-full flex items-center gap-3 p-3 text-amber-600 hover:bg-amber-50 rounded-2xl font-bold text-sm transition-all group"
                  >
                    <div className="p-2 bg-amber-50 group-hover:bg-amber-100 rounded-xl transition-colors text-amber-500">
                      <Settings size={18} />
                    </div>
                    Connect Supabase
                  </button>
                )}
              </nav>

              <div className="pt-6 border-t border-gray-100">
                <div className="p-4 bg-blue-50 rounded-2xl">
                  <p className="text-[10px] font-bold text-[#007AFF] uppercase tracking-widest mb-1">Signed in as</p>
                  <p className="text-sm font-bold text-[#1C1C1E] truncate">{profile?.username || (session ? session.user.email : 'Guest')}</p>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-40 w-full glass-card border-none rounded-none px-4 sm:px-6 py-3 sm:py-4 mb-4 sm:mb-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-1.5 sm:p-2 text-gray-500 hover:bg-gray-100 rounded-lg sm:rounded-xl transition-colors"
            >
              <Menu size={22} />
            </button>
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-[#007AFF] rounded-xl sm:rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <LayoutGrid size={20} className="sm:w-6 sm:h-6" />
            </div>
            <div className="hidden sm:block">
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight">Financely</h1>
                {!isSupabaseConfigured && (
                  <span className="px-1.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-200 rounded-md text-[9px] font-bold uppercase tracking-wider">
                    Local Mode
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-[9px] sm:text-[10px] text-[#8E8E93] font-bold uppercase tracking-wider">
                <UserIcon size={9} className="sm:w-[10px] sm:h-[10px]" />
                {profile?.username || (session ? session.user.email : 'Guest')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <button 
              onClick={() => setIsExportModalOpen(true)}
              title="Export CSV"
              className="p-1.5 sm:p-2 text-gray-500 hover:bg-gray-100 rounded-lg sm:rounded-xl transition-colors"
            >
              <Download size={18} className="sm:w-[22px] sm:h-[22px]" />
            </button>
            <button 
              onClick={() => setIsCategoryManagerOpen(true)}
              title="Category Settings"
              className="p-1.5 sm:p-2 text-gray-500 hover:bg-gray-100 rounded-lg sm:rounded-xl transition-colors"
            >
              <Settings size={18} className="sm:w-[22px] sm:h-[22px]" />
            </button>
            {isSupabaseConfigured && (
              <button 
                onClick={() => {
                  if (confirm('Are you sure you want to log out?')) {
                    supabase.auth.signOut();
                  }
                }}
                title="Log Out"
                className="p-1.5 sm:p-2 text-[#FF3B30] hover:bg-red-50 rounded-lg sm:rounded-xl transition-colors"
              >
                <LogOut size={18} className="sm:w-[22px] sm:h-[22px]" />
              </button>
            )}
            <button 
              onClick={() => setIsModalOpen(true)}
              className="px-3 sm:px-5 py-2 sm:py-2.5 bg-[#007AFF] text-white rounded-xl sm:rounded-2xl font-bold text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 shadow-lg shadow-blue-500/20 hover:bg-[#0066CC] transition-all"
            >
              <Plus size={16} className="sm:w-5 sm:h-5" />
              <span className="hidden xs:inline sm:inline">Add</span>
              <span className="hidden sm:inline">Transaction</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 space-y-6 sm:space-y-8">
        {/* Undo/Redo Feedback */}
        <AnimatePresence>
          {lastAction && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-[#1C1C1E] text-white px-4 py-2 rounded-full text-sm font-semibold shadow-xl flex items-center gap-2"
            >
              <Check size={16} className="text-[#34C759]" />
              Action {lastAction}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Month Navigator */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-6 bg-white rounded-[1.5rem] sm:rounded-[2rem] border border-gray-100 shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-50 text-[#007AFF] rounded-xl sm:rounded-2xl flex items-center justify-center flex-shrink-0 animate-pulse">
              <Calendar size={20} className="sm:w-6 sm:h-6" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-[#8E8E93]">Viewing Period</span>
              <h3 className="text-base sm:text-lg font-bold text-[#1C1C1E] capitalize">
                {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </h3>
            </div>
          </div>
          
          <div className="flex items-center gap-2 self-start sm:self-center">
            <button
              onClick={() => {
                const prev = new Date(currentMonth);
                prev.setMonth(prev.getMonth() - 1);
                setCurrentMonth(prev);
              }}
              className="px-3 sm:px-4 py-2 bg-[#F2F2F7] text-[#1C1C1E] rounded-xl text-xs font-bold hover:bg-gray-200 transition-colors flex items-center gap-1 sm:gap-1.5"
            >
              ← Prev Month
            </button>
            
            <button
              onClick={() => {
                setCurrentMonth(new Date());
              }}
              className="px-3 py-2 bg-blue-50 text-[#007AFF] rounded-xl text-xs font-bold hover:bg-blue-100 transition-colors"
            >
              Current
            </button>
            
            <button
              onClick={() => {
                const next = new Date(currentMonth);
                next.setMonth(next.getMonth() + 1);
                setCurrentMonth(next);
              }}
              className="px-3 sm:px-4 py-2 bg-[#F2F2F7] text-[#1C1C1E] rounded-xl text-xs font-bold hover:bg-gray-200 transition-colors flex items-center gap-1 sm:gap-1.5"
            >
              Next Month →
            </button>
          </div>
        </motion.div>

        {/* Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card rounded-[1.5rem] sm:rounded-[2rem] p-5 sm:p-8"
          >
            <div className="flex items-center justify-between mb-2 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-50 flex items-center justify-center text-blue-500">
                <Wallet size={20} className="sm:w-6 sm:h-6" />
              </div>
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-[#8E8E93]">Total Balance</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{formatCurrency(stats.balance)}</h2>
            <div className="text-[#8E8E93] text-xs mt-1 sm:mt-2 flex flex-col gap-0.5">
              <span className="flex items-center gap-1 font-medium">
                <TrendingUp size={12} className="text-[#34C759]" />
                Safe to spend (All-time total)
              </span>
              {carryover !== 0 && (
                <span className="text-[10px] text-gray-500 font-bold">
                  Includes {formatCurrency(carryover)} carried over
                </span>
              )}
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card rounded-[1.5rem] sm:rounded-[2rem] p-5 sm:p-8"
          >
            <div className="flex items-center justify-between mb-2 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-green-50 flex items-center justify-center text-green-500">
                <ArrowUpRight size={20} className="sm:w-6 sm:h-6" />
              </div>
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-[#8E8E93]">Income</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{formatCurrency(monthlyStats.income)}</h2>
            <div className="text-[#8E8E93] text-[10px] sm:text-xs mt-1 sm:mt-2 flex flex-col gap-0.5">
              <span className="text-[#34C759] font-medium">
                Earnings in {currentMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </span>
              {monthlyStats.carryoverToUse > 0 && (
                <span className="text-gray-500 font-medium font-bold">
                  ⚡ + {formatCurrency(monthlyStats.carryoverToUse)} Carried Over
                </span>
              )}
              {monthlyStats.borrowedInMonth > 0 && (
                <span className="text-[#007AFF] font-medium font-bold flex items-center gap-1">
                  ⚡ + {formatCurrency(monthlyStats.borrowedInMonth)} Borrowed (Loans)
                </span>
              )}
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-card rounded-[1.5rem] sm:rounded-[2rem] p-5 sm:p-8"
          >
            <div className="flex items-center justify-between mb-2 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-rose-50 flex items-center justify-center text-rose-500">
                <ArrowDownRight size={20} className="sm:w-6 sm:h-6" />
              </div>
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-[#8E8E93]">Expenses</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{formatCurrency(monthlyStats.expenses)}</h2>
            <div className="text-[#8E8E93] text-[10px] sm:text-xs mt-1 sm:mt-2 flex flex-col gap-0.5">
              <span className="text-[#FF3B30] font-medium">
                Spending in {currentMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </span>
              {monthlyStats.repaidInMonth > 0 && (
                <span className="text-gray-500 font-medium font-bold flex items-center gap-1">
                  💸 includes {formatCurrency(monthlyStats.repaidInMonth)} Loan Repayment
                </span>
              )}
            </div>
          </motion.div>
        </div>

        {/* Reports Section */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Overview</h2>
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0">
              <button
                onClick={() => setIsReportSettingsOpen(!isReportSettingsOpen)}
                className={cn(
                  "flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 text-[10px] sm:text-xs font-bold rounded-xl transition-all border shrink-0",
                  isReportSettingsOpen ? "bg-[#1C1C1E] text-white border-[#1C1C1E]" : "bg-white text-[#8E8E93] border-gray-200"
                )}
              >
                <Filter size={12} className="sm:w-[14px] sm:h-[14px]" />
                Filters
              </button>
              <div className="flex p-0.5 sm:p-1 bg-gray-200/50 rounded-xl shrink-0">
                {(['week', 'month', 'year', 'custom'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setTimeRange(r)}
                    className={cn(
                      "px-2 sm:px-4 py-1 text-[10px] sm:text-xs font-bold rounded-lg capitalize transition-all",
                      timeRange === r ? "bg-white text-[#1C1C1E] shadow-sm" : "text-[#8E8E93]"
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <AnimatePresence>
            {isReportSettingsOpen && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="glass-card rounded-[2rem] p-5 md:p-6 mb-4 flex flex-wrap gap-4 md:gap-6 items-end">
                  {timeRange === 'custom' && (
                    <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                      <div className="space-y-2 flex-grow">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#8E8E93]">Start Date</label>
                        <input 
                          type="date" 
                          value={customRange.start}
                          onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
                          className="apple-input bg-white/50 w-full"
                        />
                      </div>
                      <div className="space-y-2 flex-grow">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#8E8E93]">End Date</label>
                        <input 
                          type="date" 
                          value={customRange.end}
                          onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
                          className="apple-input bg-white/50 w-full"
                        />
                      </div>
                    </div>
                  )}
                  
                  <div className="space-y-2 w-full sm:w-auto">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#8E8E93]">Types</label>
                    <div className="flex gap-2">
                      {(['income', 'expense'] as const).map(type => (
                        <button
                          key={type}
                          onClick={() => setReportTypes(prev => 
                            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                          )}
                          className={cn(
                            "px-3 py-1.5 rounded-xl text-[10px] font-bold border capitalize transition-all",
                            reportTypes.includes(type) ? "bg-[#007AFF] border-[#007AFF] text-white shadow-sm" : "bg-white border-gray-200 text-gray-500"
                          )}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 w-full sm:w-auto">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#8E8E93]">Search Notes</label>
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input 
                        type="text" 
                        placeholder="Search in reports..."
                        value={reportSearchQuery}
                        onChange={(e) => setReportSearchQuery(e.target.value)}
                        className="apple-input bg-white/50 pl-9 py-2 text-xs"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 w-full sm:w-auto">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#8E8E93]">Time of Day</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="time" 
                        value={reportTimeOfDay.start}
                        onChange={(e) => setReportTimeOfDay(prev => ({ ...prev, start: e.target.value }))}
                        className="apple-input bg-white/50 py-1.5 text-xs w-full"
                      />
                      <span className="text-gray-400 font-bold">to</span>
                      <input 
                        type="time" 
                        value={reportTimeOfDay.end}
                        onChange={(e) => setReportTimeOfDay(prev => ({ ...prev, end: e.target.value }))}
                        className="apple-input bg-white/50 py-1.5 text-xs w-full"
                      />
                    </div>
                  </div>

                  {availableTags.length > 0 && (
                    <div className="space-y-2 w-full">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[#8E8E93]">Filter Tags</label>
                      <div className="flex flex-wrap gap-2">
                        {availableTags.map(tag => (
                          <button
                            key={tag}
                            onClick={() => setReportTags(prev => 
                              prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                            )}
                            className={cn(
                              "px-3 py-1 rounded-full text-[10px] font-bold border transition-all",
                              reportTags.includes(tag) ? "bg-[#007AFF] border-[#007AFF] text-white" : "bg-white border-gray-200 text-gray-500"
                            )}
                          >
                            #{tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 w-full">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#8E8E93]">Filter Categories</label>
                    <div className="flex flex-wrap gap-2">
                      {categories.map(cat => (
                        <button
                          key={cat.id}
                          onClick={() => setReportCategories(prev => 
                            prev.includes(cat.name) ? prev.filter(n => n !== cat.name) : [...prev, cat.name]
                          )}
                          className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-bold border transition-all",
                            reportCategories.includes(cat.name) ? "bg-[#007AFF] border-[#007AFF] text-white" : "bg-white border-gray-200 text-gray-500"
                          )}
                        >
                          {cat.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <Reports 
            transactions={transactions} 
            categories={categories} 
            timeRange={timeRange} 
            customRange={timeRange === 'custom' ? customRange : undefined}
            selectedCategories={reportCategories}
            selectedTypes={reportTypes}
            searchQuery={reportSearchQuery}
            timeOfDay={reportTimeOfDay}
            selectedTags={reportTags}
            selectedMonth={currentMonth}
          />
        </section>

        {/* Transactions List */}
        <section className="space-y-6">
          <div className="flex flex-col gap-4 sm:gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Transactions</h2>
                {selectedDayLabel !== 'all' && (
                  <p className="text-[#8E8E93] text-[10px] sm:text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    Filtered by {selectedDayLabel === 'specific' ? (listDateRange.start || 'selected day') : selectedDayLabel}
                  </p>
                )}
              </div>
              
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                <div className="flex p-1 bg-gray-100 rounded-xl overflow-x-auto no-scrollbar">
                  {(['all', 'today', 'yesterday', 'specific'] as const).map((label) => (
                    <button
                      key={label}
                      onClick={() => {
                        setSelectedDayLabel(label);
                        if (label === 'all') setListDateRange({ start: '', end: '' });
                      }}
                      className={cn(
                        "px-3 sm:px-4 py-1.5 text-[10px] sm:text-xs font-bold rounded-lg capitalize transition-all shrink-0",
                        selectedDayLabel === label ? "bg-white text-[#1C1C1E] shadow-sm" : "text-[#8E8E93]"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="relative flex-grow sm:min-w-[200px] md:min-w-[240px]">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 sm:w-4 sm:h-4" />
                  <input 
                    type="text" 
                    placeholder="Search notes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1 sm:flex-initial">
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value as any)}
                      className="w-full appearance-none bg-white border border-gray-200 rounded-xl px-3 sm:px-4 py-2 pr-9 text-[10px] sm:text-[11px] font-bold text-[#1C1C1E] focus:outline-none shadow-sm transition-all"
                    >
                      <option value="all">Types</option>
                      <option value="income">Income</option>
                      <option value="expense">Expense</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8E8E93] pointer-events-none" />
                  </div>

                  <div className="relative flex-1 sm:flex-initial">
                    <select
                      value={listTimePeriod}
                      onChange={(e) => setListTimePeriod(e.target.value as any)}
                      className="w-full appearance-none bg-white border border-gray-200 rounded-xl px-3 sm:px-4 py-2 pr-9 text-[10px] sm:text-[11px] font-bold text-[#1C1C1E] focus:outline-none shadow-sm transition-all"
                    >
                      <option value="all">All Day</option>
                      <option value="morning">Morning</option>
                      <option value="afternoon">Afternoon</option>
                      <option value="evening">Evening</option>
                      <option value="night">Night</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8E8E93] pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center gap-3 py-3 border-y border-gray-100">
              <div className="flex items-center gap-2">
                <div className="relative flex-grow sm:flex-initial">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="w-full appearance-none bg-white border border-gray-200 rounded-xl px-3 sm:px-4 py-2 pr-9 text-[10px] sm:text-[11px] font-bold text-[#1C1C1E] focus:outline-none shadow-sm transition-all"
                  >
                    <option value="date">Date</option>
                    <option value="amount">Amount</option>
                    <option value="category">Category</option>
                    <option value="type">Type</option>
                  </select>
                  <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8E8E93] pointer-events-none" />
                </div>

                <button 
                  onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                  className="p-2 bg-white border border-gray-200 rounded-xl text-gray-500 hover:text-[#1C1C1E] shadow-sm"
                >
                  <ArrowUpDown size={12} className={cn("transition-transform duration-300", sortOrder === 'asc' ? "rotate-180" : "")} />
                </button>
              </div>

              <div className="flex items-center gap-2 lg:ml-auto overflow-x-auto no-scrollbar py-1 -mx-4 px-4 sm:mx-0 sm:px-0">
                {selectedDayLabel === 'specific' ? (
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-[10px] font-bold text-[#8E8E93] uppercase tracking-widest">Select Day:</span>
                    <div className="flex items-center gap-1.5 shrink-0 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
                      <input 
                        type="date"
                        value={listDateRange.start}
                        onChange={(e) => setListDateRange({ start: e.target.value, end: e.target.value })}
                        className="px-2 py-1 text-[10px] font-bold bg-transparent border-none focus:ring-0 cursor-pointer"
                      />
                    </div>
                  </div>
                ) : selectedDayLabel === 'all' && (
                  <>
                    <span className="shrink-0 text-[10px] font-bold text-[#8E8E93] uppercase tracking-widest">Range:</span>
                    <div className="flex items-center gap-1.5 shrink-0 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
                      <input 
                        type="date"
                        value={listDateRange.start}
                        onChange={(e) => setListDateRange(prev => ({ ...prev, start: e.target.value }))}
                        className="px-2 py-1 text-[10px] font-bold bg-transparent border-none focus:ring-0 cursor-pointer"
                      />
                      <span className="text-gray-300 font-bold text-[10px]">to</span>
                      <input 
                        type="date"
                        value={listDateRange.end}
                        onChange={(e) => setListDateRange(prev => ({ ...prev, end: e.target.value }))}
                        className="px-2 py-1 text-[10px] font-bold bg-transparent border-none focus:ring-0 cursor-pointer"
                      />
                    </div>
                  </>
                )}
                {(listDateRange.start || listDateRange.end || selectedDayLabel !== 'all') && (
                  <button 
                    onClick={() => {
                      setListDateRange({ start: '', end: '' });
                      setSelectedDayLabel('all');
                      setSearchQuery('');
                      setFilterType('all');
                      setListTimePeriod('all');
                    }}
                    className="shrink-0 flex items-center gap-2 px-3 py-2 bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-100 transition-colors text-[10px] font-bold"
                  >
                    <X size={14} />
                    <span>Clear Filters</span>
                  </button>
                )}
              </div>
            </div>

            {selectedDayLabel !== 'all' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 bg-white/50 backdrop-blur-md rounded-2xl border border-gray-100/50 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center">
                    <Wallet size={16} />
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-[#8E8E93] uppercase tracking-widest">Total Transactions</p>
                    <p className="text-sm font-bold">{filteredStats.count}</p>
                  </div>
                </div>
                <div className="p-4 bg-white/50 backdrop-blur-md rounded-2xl border border-gray-100/50 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-green-50 text-green-500 flex items-center justify-center">
                    <TrendingUp size={16} />
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-[#8E8E93] uppercase tracking-widest">Income for {selectedDayLabel}</p>
                    <p className="text-sm font-bold text-[#34C759]">{formatCurrency(filteredStats.income)}</p>
                  </div>
                </div>
                <div className="p-4 bg-white/50 backdrop-blur-md rounded-2xl border border-gray-100/50 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center">
                    <TrendingUp size={16} className="rotate-180" />
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-[#8E8E93] uppercase tracking-widest">Expense for {selectedDayLabel}</p>
                    <p className="text-sm font-bold text-rose-500">{formatCurrency(filteredStats.expenses)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3">
            <AnimatePresence mode="popLayout" initial={false}>
              {filteredTransactions.length > 0 ? (
                filteredTransactions.map((transaction) => (
                  <TransactionItem
                    key={transaction.id}
                    transaction={transaction}
                    categories={categories}
                    onDelete={deleteTransaction}
                    onEdit={setEditingTransaction}
                    isSelected={selectedIds.includes(transaction.id)}
                    onSelect={toggleSelect}
                  />
                ))
              ) : (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-20 text-[#8E8E93]"
                >
                  <p className="text-lg">No transactions found</p>
                  <p className="text-sm">Add one to start tracking </p>
                  {categories.length === 0 && (
                    <button 
                      onClick={async () => {
                        const { INITIAL_CATEGORIES } = await import('./constants');
                        for (const cat of INITIAL_CATEGORIES) {
                          const { id, ...rest } = cat;
                          await addCategory(rest);
                        }
                      }}
                      className="mt-4 px-4 py-2 bg-blue-50 text-[#007AFF] text-xs font-bold rounded-xl hover:bg-blue-100 transition-colors"
                    >
                      Initialize Default Categories
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>
      </main>

      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 glass-card bg-white/95 rounded-[2rem] p-3 shadow-2xl flex items-center gap-4 border-blue-100 max-w-[90vw] lg:max-w-none"
          >
            <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 rounded-2xl border border-blue-100">
              <span className="w-8 h-8 bg-[#007AFF] text-white rounded-xl flex items-center justify-center font-bold text-sm shadow-lg shadow-blue-500/20">
                {selectedIds.length}
              </span>
              <span className="text-sm font-bold text-[#007AFF] whitespace-nowrap">Selected</span>
            </div>
            
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar max-w-[200px] sm:max-w-[400px] border-x border-gray-100 px-2">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => bulkCategorize(cat.name)}
                  title={`Move to ${cat.name}`}
                  className="flex-shrink-0 p-2 hover:bg-gray-50 rounded-xl transition-all group flex flex-col items-center gap-1"
                >
                  <div 
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm transition-transform group-hover:scale-110"
                    style={{ backgroundColor: cat.color }}
                  >
                    {(() => {
                      const Icon = ICON_MAP[cat.iconName] || ICON_MAP.Layers;
                      return <Icon size={16} />;
                    })()}
                  </div>
                  <span className="text-[9px] font-bold text-[#8E8E93] uppercase tracking-tighter truncate max-w-[40px]">
                    {cat.name}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 px-1">
              <button 
                onClick={bulkDelete}
                className="p-3 text-[#FF3B30] hover:bg-[#FF3B30]/5 rounded-2xl transition-all"
                title="Delete Selected"
              >
                <Trash2 size={22} />
              </button>
              
              <button 
                onClick={() => setSelectedIds([])}
                className="p-3 text-[#8E8E93] hover:bg-gray-100 rounded-2xl transition-all"
                title="Cancel Selection"
              >
                <X size={22} />
              </button>
            </div>
          </motion.div>
        )}

        {(isModalOpen || editingTransaction) && (
          <AddTransactionModal
            categories={categories}
            initialData={editingTransaction || undefined}
            onAdd={(data) => {
              if (editingTransaction) {
                updateTransaction({ ...data, id: editingTransaction.id });
              } else {
                addTransaction(data);
              }
            }}
            onClose={() => {
              setIsModalOpen(false);
              setEditingTransaction(null);
            }}
          />
        )}
        {isExportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsExportModalOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl"
            >
              <h2 className="text-xl font-bold mb-6">Export Transactions</h2>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#8E8E93]">START DATE</label>
                  <input 
                    type="date" 
                    value={exportDateRange.start}
                    onChange={(e) => setExportDateRange(prev => ({ ...prev, start: e.target.value }))}
                    className="apple-input"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#8E8E93]">END DATE</label>
                  <input 
                    type="date" 
                    value={exportDateRange.end}
                    onChange={(e) => setExportDateRange(prev => ({ ...prev, end: e.target.value }))}
                    className="apple-input"
                  />
                </div>
                <button 
                  onClick={handleExport}
                  className="w-full bg-[#007AFF] text-white py-3 rounded-2xl font-bold mt-4"
                >
                  Download CSV
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {isCategoryManagerOpen && (
          <CategoryManager
            categories={categories}
            onAdd={addCategory}
            onUpdate={updateCategory}
            onDelete={deleteCategory}
            onClose={() => setIsCategoryManagerOpen(false)}
          />
        )}
        {isLoanManagerOpen && (
          <LoanManager
            loans={loans}
            payments={loanPayments}
            onAdd={addLoan}
            onPayment={recordLoanPayment}
            onDelete={deleteLoan}
            onClose={() => setIsLoanManagerOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
