"""
Scopit - Roof measurement from free USGS 3DEP LiDAR.

Pipeline: address -> Census geocoder -> public 3DEP point cloud (Entwine Point Tiles on AWS)
-> building candidates -> roof planes -> faces / typed edges in the Roof Analyzer's RoofData shape.
All data sources are public domain and free; nothing here calls a paid API.
"""
