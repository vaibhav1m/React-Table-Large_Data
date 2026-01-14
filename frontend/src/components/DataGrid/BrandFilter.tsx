import { useEffect, useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { setSelectedBrand } from '../../store/dataGridSlice';
import { dataService } from '../../services/api.service';
import './BrandFilter.css';

export function BrandFilter() {
    const dispatch = useAppDispatch();
    const selectedBrand = useAppSelector((state) => state.dataGrid.selectedBrand);
    const [brands, setBrands] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Fetch brand values on mount
    useEffect(() => {
        const fetchBrands = async () => {
            try {
                setIsLoading(true);
                const result = await dataService.getFilterValues('master_brand_id');
                setBrands(result.values.filter(Boolean).sort());
                setError(null);
            } catch (err) {
                console.error('[BrandFilter] Failed to fetch brands:', err);
                setError('Failed to load brands');
            } finally {
                setIsLoading(false);
            }
        };

        fetchBrands();
    }, []);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value;
        dispatch(setSelectedBrand(value === '' ? null : value));
    }, [dispatch]);

    if (error) {
        return (
            <div className="brand-filter brand-filter--error">
                <span className="brand-filter__label">Brand:</span>
                <span className="brand-filter__error">{error}</span>
            </div>
        );
    }

    return (
        <div className="brand-filter">
            <span className="brand-filter__label">Brand:</span>
            <select
                className="brand-filter__select"
                value={selectedBrand ?? ''}
                onChange={handleChange}
                disabled={isLoading}
            >
                <option value="">All</option>
                {brands.map((brand) => (
                    <option key={brand} value={brand}>
                        {brand}
                    </option>
                ))}
            </select>
            {isLoading && <span className="brand-filter__loading">Loading...</span>}
        </div>
    );
}
