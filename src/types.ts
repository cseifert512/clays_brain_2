export interface EmbeddingItem {
    filename: string;
    version?: string;
    tsne: number[];
    pca: number[];
    tsne_2d: number[];
    tsne_2d_grid: number[];
    tsne_2d_grid_snap: number[];
    cluster_kmeans: number;
    cluster_dbscan: number;
    cluster_agglom: number;
}

export type LayoutAlgorithm = 'tsne' | 'pca' | 'kmeans' | 'dbscan' | 'agglom';

// CSS module declaration
declare module '*.css' {
    const content: string;
    export default content;
}
