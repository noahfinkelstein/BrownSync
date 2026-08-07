import CoreLocation
import MapLibre
import SwiftUI

struct MapViewRepresentable: UIViewRepresentable {
    let markers: [MapEventMarker]
    @Binding var status: MapLoadStatus
    let onSelect: (AppRoute) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(status: $status, onSelect: onSelect)
    }

    func makeUIView(context: Context) -> MLNMapView {
        do {
            let bundle = Bundle.main
            guard let styleURL = bundle.url(forResource: "style", withExtension: "json") else {
                throw StyleLoaderError.missingResource("style.json")
            }
            guard let archiveURL = bundle.url(
                forResource: "providence",
                withExtension: "pmtiles"
            ) else {
                throw StyleLoaderError.missingResource("providence.pmtiles")
            }
            guard let resourcesURL = bundle.resourceURL else {
                throw StyleLoaderError.missingResource("bundle resources")
            }
            let glyphsURL = resourcesURL.appendingPathComponent(
                "glyphs",
                isDirectory: true
            )

            let campusBuildingsData = try bundledData(
                named: "campus-buildings",
                extension: "geojson"
            )
            _ = try CampusBuildings.decode(campusBuildingsData)
            context.coordinator.setCampusBuildingsData(campusBuildingsData)
            let camera = try StyleLoader.camera(
                from: try Data(contentsOf: styleURL)
            )
            let preparedStyleURL = try StyleLoader.prepare(
                styleURL: styleURL,
                archiveURL: archiveURL,
                glyphsDirectoryURL: glyphsURL
            )
            let mapView = MLNMapView(
                frame: .zero,
                styleURL: preparedStyleURL
            )
            configure(mapView, coordinator: context.coordinator)
            apply(camera, to: mapView)
            context.coordinator.update(
                markers: markers,
                onSelect: onSelect,
                in: mapView
            )
            return mapView
        } catch {
            let mapView = MLNMapView(frame: .zero, styleURL: nil)
            configure(mapView, coordinator: context.coordinator)
            context.coordinator.fail(error)
            return mapView
        }
    }

    func updateUIView(_ mapView: MLNMapView, context: Context) {
        context.coordinator.update(
            markers: markers,
            onSelect: onSelect,
            in: mapView
        )
    }

    private func bundledData(named name: String, extension fileExtension: String) throws -> Data {
        guard let url = Bundle.main.url(
            forResource: name,
            withExtension: fileExtension
        ) else {
            throw StyleLoaderError.missingResource("\(name).\(fileExtension)")
        }
        return try Data(contentsOf: url)
    }

    private func configure(
        _ mapView: MLNMapView,
        coordinator: Coordinator
    ) {
        mapView.delegate = coordinator
    }

    private func apply(_ camera: StyleCamera, to mapView: MLNMapView) {
        let center = CLLocationCoordinate2D(
            latitude: camera.latitude,
            longitude: camera.longitude
        )
        let normalizedBearing = camera.bearing
            .truncatingRemainder(dividingBy: 360) + (camera.bearing < 0 ? 360 : 0)
        mapView.setCenter(
            center,
            zoomLevel: camera.zoom,
            direction: normalizedBearing,
            animated: false
        )
        let pitchedCamera = mapView.camera
        pitchedCamera.pitch = camera.pitch
        mapView.setCamera(pitchedCamera, animated: false)
    }

    @MainActor
    final class Coordinator: NSObject, @MainActor MLNMapViewDelegate {
        private static let campusSourceIdentifier = "brown-campus-buildings"
        private static let campusLabelLayerIdentifier =
            "brown-campus-building-labels"

        @Binding private var status: MapLoadStatus
        private var campusBuildingsData: Data?
        private var renderedMarkers: [MapEventMarker] = []
        private var markerAnnotations: [MLNPointAnnotation] = []
        private var routesByAnnotation: [ObjectIdentifier: AppRoute] = [:]
        private var onSelect: (AppRoute) -> Void

        init(
            status: Binding<MapLoadStatus>,
            onSelect: @escaping (AppRoute) -> Void
        ) {
            _status = status
            self.onSelect = onSelect
        }

        func setCampusBuildingsData(_ data: Data) {
            campusBuildingsData = data
        }

        func update(
            markers: [MapEventMarker],
            onSelect: @escaping (AppRoute) -> Void,
            in mapView: MLNMapView
        ) {
            self.onSelect = onSelect
            guard markers != renderedMarkers else { return }

            if !markerAnnotations.isEmpty {
                mapView.removeAnnotations(markerAnnotations)
            }
            renderedMarkers = markers
            markerAnnotations = markers.map { marker in
                let annotation = MLNPointAnnotation()
                annotation.coordinate = CLLocationCoordinate2D(
                    latitude: marker.coordinate.latitude,
                    longitude: marker.coordinate.longitude
                )
                annotation.title = marker.title
                return annotation
            }
            routesByAnnotation = Dictionary(
                uniqueKeysWithValues: zip(markerAnnotations, markers).map {
                    (ObjectIdentifier($0.0), $0.1.route)
                }
            )
            if !markerAnnotations.isEmpty {
                mapView.addAnnotations(markerAnnotations)
            }
        }

        func mapView(
            _ mapView: MLNMapView,
            didFinishLoading style: MLNStyle
        ) {
            do {
                try installCampusBuildings(in: style)
            } catch {
                fail(error)
            }
        }

        func mapView(
            _ mapView: MLNMapView,
            didSelect annotation: MLNAnnotation
        ) {
            guard let route = routesByAnnotation[
                ObjectIdentifier(annotation)
            ] else {
                return
            }
            mapView.deselectAnnotation(annotation, animated: false)
            onSelect(route)
        }

        func mapViewDidFinishRenderingMap(
            _ mapView: MLNMapView,
            fullyRendered: Bool
        ) {
            guard fullyRendered else { return }
            status = status.acceptingFullyRendered()
            guard status == .ready else { return }
            print("BROWNSYNC_MAP_READY fullyRendered=true")
        }

        func mapViewDidFailLoadingMap(
            _ mapView: MLNMapView,
            withError error: Error
        ) {
            fail(error)
        }

        func fail(_ error: Error) {
            let message = error.localizedDescription
            status = .failed(message)
            print("BROWNSYNC_MAP_FAILED \(message)")
        }

        private func installCampusBuildings(in style: MLNStyle) throws {
            guard
                style.source(
                    withIdentifier: Self.campusSourceIdentifier
                ) == nil,
                let campusBuildingsData
            else {
                return
            }

            let shape = try MLNShape(
                data: campusBuildingsData,
                encoding: String.Encoding.utf8.rawValue
            )
            let source = MLNShapeSource(
                identifier: Self.campusSourceIdentifier,
                shape: shape,
                options: nil
            )
            style.addSource(source)

            let labels = MLNSymbolStyleLayer(
                identifier: Self.campusLabelLayerIdentifier,
                source: source
            )
            labels.minimumZoomLevel = 15
            labels.text = NSExpression(forKeyPath: "label")
            labels.textFontNames = NSExpression(
                forConstantValue: ["Noto Sans Medium"]
            )
            labels.textFontSize = NSExpression(forConstantValue: 11)
            labels.textColor = NSExpression(
                forConstantValue: UIColor.label
            )
            labels.textHaloColor = NSExpression(
                forConstantValue: UIColor.systemBackground
            )
            labels.textHaloWidth = NSExpression(forConstantValue: 1)
            style.addLayer(labels)
        }
    }
}
