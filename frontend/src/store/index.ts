import { configureStore } from '@reduxjs/toolkit';
import dataGridReducer from './dataGridSlice';

export const store = configureStore({
    reducer: {
        dataGrid: dataGridReducer,
    },
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: false,
        }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
