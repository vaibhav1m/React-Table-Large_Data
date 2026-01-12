import React, { useState, useCallback, useRef, useEffect } from 'react';
import { dataService } from '../../services/api.service';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { setFilters, fetchInitialData } from '../../store/dataGridSlice';
import './SearchBar.css';

// =============================================================================
// SearchBar Component - Autocomplete search with database query
// =============================================================================

interface SearchResult {
    column: string;
    value: string;
    label: string;
}

interface SearchBarProps {
    placeholder?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
    placeholder = "Search by Category, Sub-Category, SKU & Product Name..."
}) => {
    const dispatch = useAppDispatch();
    const filters = useAppSelector((state) => state.dataGrid.filters);

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [selectedFilter, setSelectedFilter] = useState<{ column: string; value: string } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Sync selectedFilter with Redux filters on mount
    useEffect(() => {
        if (filters.length > 0) {
            const searchableColumns = ['category', 'sub_category', 'sku', 'product_name'];
            const searchFilter = filters.find(f =>
                searchableColumns.includes(f.column) && f.operator === 'eq'
            );
            if (searchFilter) {
                setSelectedFilter({ column: searchFilter.column, value: String(searchFilter.value) });
                setQuery(String(searchFilter.value));
            }
        }
    }, []);

    // Debounced search
    const performSearch = useCallback(async (searchQuery: string) => {
        if (searchQuery.length < 2) {
            setResults([]);
            setShowDropdown(false);
            return;
        }

        setIsLoading(true);
        try {
            const response = await dataService.search(searchQuery);
            setResults(response.results);
            setShowDropdown(response.results.length > 0);
        } catch (error) {
            console.error('[SearchBar] Search error:', error);
            setResults([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Handle input change with debounce
    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setQuery(value);
        setFocusedIndex(-1);
        setSelectedFilter(null); // Clear selection when typing

        // Clear existing debounce
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        // Debounce search
        debounceRef.current = setTimeout(() => {
            performSearch(value);
        }, 300);
    }, [performSearch]);

    // Handle result selection
    const handleSelect = useCallback((result: SearchResult) => {
        // Add filter for the selected value
        const filter = {
            column: result.column,
            operator: 'eq' as const,
            value: result.value,
        };

        dispatch(setFilters([filter]));
        dispatch(fetchInitialData());

        // Update UI to show selected value
        setSelectedFilter({ column: result.column, value: result.value });
        setQuery(result.value);
        setResults([]);
        setShowDropdown(false);
        inputRef.current?.blur();
    }, [dispatch]);

    // Handle clear filter - go back to all data
    const handleClear = useCallback(() => {
        setQuery('');
        setSelectedFilter(null);
        setResults([]);
        setShowDropdown(false);
        dispatch(setFilters([])); // Clear all filters
        dispatch(fetchInitialData()); // Reload all data
        inputRef.current?.focus();
    }, [dispatch]);

    // Handle keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            if (selectedFilter) {
                handleClear();
            } else {
                setShowDropdown(false);
                inputRef.current?.blur();
            }
            return;
        }

        if (!showDropdown) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setFocusedIndex(prev => Math.min(prev + 1, results.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setFocusedIndex(prev => Math.max(prev - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (focusedIndex >= 0 && focusedIndex < results.length) {
                    handleSelect(results[focusedIndex]);
                }
                break;
        }
    }, [showDropdown, results, focusedIndex, handleSelect, selectedFilter, handleClear]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(e.target as Node) &&
                inputRef.current &&
                !inputRef.current.contains(e.target as Node)
            ) {
                setShowDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Group results by column for display
    const groupedResults = results.reduce((acc, result) => {
        if (!acc[result.column]) {
            acc[result.column] = [];
        }
        acc[result.column].push(result);
        return acc;
    }, {} as Record<string, SearchResult[]>);

    const columnLabels: Record<string, string> = {
        category: 'Category',
        sub_category: 'Sub Category',
        sku: 'SKU',
        product_name: 'Product Name',
    };

    return (
        <div className="search-bar-container">
            <div className={`search-input-wrapper ${selectedFilter ? 'has-filter' : ''}`}>
                <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                </svg>

                {selectedFilter && (
                    <span className="filter-badge">
                        {columnLabels[selectedFilter.column] || selectedFilter.column}:
                    </span>
                )}

                <input
                    ref={inputRef}
                    type="text"
                    className="search-input"
                    placeholder={selectedFilter ? '' : placeholder}
                    value={query}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => !selectedFilter && results.length > 0 && setShowDropdown(true)}
                />

                {isLoading && <div className="search-spinner" />}

                {/* Clear button - shows when there's a filter or text */}
                {(selectedFilter || query.length > 0) && (
                    <button
                        className="search-clear-btn"
                        onClick={handleClear}
                        title="Clear filter and show all data"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>

            {showDropdown && (
                <div ref={dropdownRef} className="search-dropdown">
                    {Object.entries(groupedResults).map(([column, items]) => (
                        <div key={column} className="search-group">
                            <div className="search-group-header">
                                {columnLabels[column] || column}
                            </div>
                            {items.slice(0, 5).map((result, idx) => {
                                const globalIdx = results.indexOf(result);
                                return (
                                    <div
                                        key={`${result.column}-${result.value}-${idx}`}
                                        className={`search-result ${globalIdx === focusedIndex ? 'focused' : ''}`}
                                        onClick={() => handleSelect(result)}
                                        onMouseEnter={() => setFocusedIndex(globalIdx)}
                                    >
                                        <span className="result-value">{result.value}</span>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SearchBar;
