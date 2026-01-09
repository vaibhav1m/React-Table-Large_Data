import { useState, useCallback } from 'react';
import type { DimensionColumn } from '../../types/data.types';
import './DrillDownSelector.css';

interface DrillDownSelectorProps {
    availableDimensions: DimensionColumn[];
    selectedDimensions: string[];
    onApply: (dimensions: string[]) => void;
    onClose: () => void;
}

export function DrillDownSelector({
    availableDimensions,
    selectedDimensions,
    onApply,
    onClose,
}: DrillDownSelectorProps) {
    const [localSelected, setLocalSelected] = useState<string[]>(selectedDimensions);

    const handleToggle = useCallback((name: string) => {
        setLocalSelected((prev) =>
            prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]
        );
    }, []);

    const handleSelectAll = useCallback(() => {
        if (localSelected.length === availableDimensions.length) {
            setLocalSelected([]);
        } else {
            setLocalSelected(availableDimensions.map((d) => d.name));
        }
    }, [availableDimensions, localSelected.length]);

    const handleReset = useCallback(() => {
        setLocalSelected(['category']); // Default to category only
    }, []);

    const handleApply = useCallback(() => {
        if (localSelected.length > 0) {
            onApply(localSelected);
        }
    }, [localSelected, onApply]);

    const isAllSelected = localSelected.length === availableDimensions.length;
    const isPartialSelected = localSelected.length > 0 && localSelected.length < availableDimensions.length;

    return (
        <div className="drill-down-overlay" onClick={onClose}>
            <div className="drill-down-modal" onClick={(e) => e.stopPropagation()}>
                <div className="drill-down-grid">
                    {/* Select All */}
                    <label className="drill-down-item">
                        <input
                            type="checkbox"
                            checked={isAllSelected}
                            ref={(el) => {
                                if (el) el.indeterminate = isPartialSelected;
                            }}
                            onChange={handleSelectAll}
                        />
                        <span>Select all</span>
                    </label>

                    {/* Dimension options */}
                    {availableDimensions
                        .filter((d) => !['master_region_id', 'master_brand_id', 'master_brand_sub_brand_', 'master_platform_id', 'panel_id', 'date'].includes(d.name))
                        .map((dim) => (
                            <label key={dim.name} className="drill-down-item">
                                <input
                                    type="checkbox"
                                    checked={localSelected.includes(dim.name)}
                                    onChange={() => handleToggle(dim.name)}
                                />
                                <span>{dim.label}</span>
                            </label>
                        ))}
                </div>

                <div className="drill-down-actions">
                    <button className="btn-reset" onClick={handleReset}>
                        RESET
                    </button>
                    <div className="actions-right">
                        <button className="btn-cancel" onClick={onClose}>
                            CANCEL
                        </button>
                        <button
                            className="btn-apply"
                            onClick={handleApply}
                            disabled={localSelected.length === 0}
                        >
                            APPLY
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
