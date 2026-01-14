import { useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { setComparison, toggleMetric, setSelectedMetrics } from '../../store/dataGridSlice';
import { SearchBar } from './SearchBar';
import './DataGridToolbar.css';

interface DataGridToolbarProps {
    totalRows: number;
    queryTimeMs: number;
    cached: boolean;
    isLoading: boolean;
    onDrillDownClick: () => void;
}

export function DataGridToolbar({
    totalRows,
    queryTimeMs,
    cached,
    isLoading,
    onDrillDownClick,
}: DataGridToolbarProps) {
    const dispatch = useAppDispatch();
    const { selectedMetrics, metadata, comparison } = useAppSelector(
        (state) => state.dataGrid
    );

    const [showMetrics, setShowMetrics] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);

    const handleMetricToggle = useCallback(
        (metric: string) => {
            dispatch(toggleMetric(metric));
        },
        [dispatch]
    );

    const handleSelectAllMetrics = useCallback(() => {
        if (!metadata) return;
        const allMetricNames = metadata.metrics.map(m => m.name);
        if (selectedMetrics.length === allMetricNames.length) {
            // Deselect all - keep at least one metric
            dispatch(setSelectedMetrics([allMetricNames[0]]));
        } else {
            // Select all
            dispatch(setSelectedMetrics(allMetricNames));
        }
    }, [dispatch, metadata, selectedMetrics.length]);

    const handleComparisonToggle = useCallback(() => {
        if (comparison) {
            dispatch(setComparison(null));
        } else {
            // Default comparison: current month vs last month
            const now = new Date();
            const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            const compStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const compEnd = new Date(now.getFullYear(), now.getMonth(), 0);

            dispatch(
                setComparison({
                    currentPeriod: {
                        start: currentStart.toISOString().split('T')[0],
                        end: currentEnd.toISOString().split('T')[0],
                    },
                    comparisonPeriod: {
                        start: compStart.toISOString().split('T')[0],
                        end: compEnd.toISOString().split('T')[0],
                    },
                })
            );
        }
        setShowDatePicker(false);
    }, [dispatch, comparison]);

    return (
        <div className="toolbar">
            <div className="toolbar-left">
                <h2 className="toolbar-title">DETAILS SUMMARY OF SALES METRICS</h2>

                {/* Database-backed Search with Autocomplete */}
                <SearchBar />
            </div>

            <div className="toolbar-right">
                {/* Parameters dropdown */}
                <div className="toolbar-button-group">
                    <button
                        className="toolbar-button"
                        onClick={() => setShowDatePicker(!showDatePicker)}
                    >
                        Parameters
                        <span className="dropdown-arrow">▼</span>
                    </button>
                    {showDatePicker && (
                        <div className="dropdown-menu">
                            <label className="dropdown-item">
                                <input
                                    type="checkbox"
                                    checked={comparison !== null}
                                    onChange={handleComparisonToggle}
                                />
                                Enable Comparison
                            </label>
                            {comparison && (
                                <div className="date-inputs">
                                    <div className="date-group">
                                        <label>Current Period</label>
                                        <input
                                            type="date"
                                            value={comparison.currentPeriod.start}
                                            onChange={(e) =>
                                                dispatch(
                                                    setComparison({
                                                        ...comparison,
                                                        currentPeriod: {
                                                            ...comparison.currentPeriod,
                                                            start: e.target.value,
                                                        },
                                                    })
                                                )
                                            }
                                        />
                                        <span>to</span>
                                        <input
                                            type="date"
                                            value={comparison.currentPeriod.end}
                                            onChange={(e) =>
                                                dispatch(
                                                    setComparison({
                                                        ...comparison,
                                                        currentPeriod: {
                                                            ...comparison.currentPeriod,
                                                            end: e.target.value,
                                                        },
                                                    })
                                                )
                                            }
                                        />
                                    </div>
                                    <div className="date-group">
                                        <label>Comparison Period</label>
                                        <input
                                            type="date"
                                            value={comparison.comparisonPeriod.start}
                                            onChange={(e) =>
                                                dispatch(
                                                    setComparison({
                                                        ...comparison,
                                                        comparisonPeriod: {
                                                            ...comparison.comparisonPeriod,
                                                            start: e.target.value,
                                                        },
                                                    })
                                                )
                                            }
                                        />
                                        <span>to</span>
                                        <input
                                            type="date"
                                            value={comparison.comparisonPeriod.end}
                                            onChange={(e) =>
                                                dispatch(
                                                    setComparison({
                                                        ...comparison,
                                                        comparisonPeriod: {
                                                            ...comparison.comparisonPeriod,
                                                            end: e.target.value,
                                                        },
                                                    })
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Metrics dropdown */}
                <div className="toolbar-button-group">
                    <button
                        className="toolbar-button"
                        onClick={() => setShowMetrics(!showMetrics)}
                    >
                        Metrics
                        <span className="dropdown-arrow">▼</span>
                    </button>
                    {showMetrics && (
                        <div className="dropdown-menu metrics-dropdown">
                            {/* Select All option */}
                            <label className="dropdown-item select-all">
                                <input
                                    type="checkbox"
                                    checked={metadata ? selectedMetrics.length === metadata.metrics.length : false}
                                    onChange={handleSelectAllMetrics}
                                />
                                Select All
                            </label>
                            <div className="dropdown-divider" />
                            {metadata?.metrics.map((metric) => (
                                <label key={metric.name} className="dropdown-item">
                                    <input
                                        type="checkbox"
                                        checked={selectedMetrics.includes(metric.name)}
                                        onChange={() => handleMetricToggle(metric.name)}
                                    />
                                    {metric.label}
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                {/* Drill-down button */}
                <button className="toolbar-button primary" onClick={onDrillDownClick}>
                    Product Details
                    <span className="dropdown-arrow">▼</span>
                </button>

                {/* Filters button */}
                <button className="toolbar-button">
                    Filters
                    <span className="filter-icon">🔍</span>
                </button>

                {/* Status info */}
                <div className="status-info">
                    {isLoading ? (
                        <span className="loading">Loading...</span>
                    ) : (
                        <>
                            <span className="row-count">{totalRows.toLocaleString()} rows</span>
                            <span className="query-time">
                                {queryTimeMs}ms {cached && '(cached)'}
                            </span>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
