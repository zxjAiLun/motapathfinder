main.floors.MT575=
{
    "floorId": "MT575",
    "title": "575 层",
    "name": "575 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 20000000000,
    "defaultGround": 380513,
    "bgm": "32.mp3",
    "weather": [
        "sun",
        2
    ],
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "3,1": [
            {
                "type": "choices",
                "text": "\t[绿色按钮,A985]如果觉得打不动的话，\n不妨来点补给再前进吧！\n又或者，如果你更喜欢绿钥匙……？",
                "choices": [
                    {
                        "text": "获得6把绿钥匙",
                        "color": [
                            75,
                            217,
                            63,
                            1
                        ],
                        "need": "flag:575f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "6"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:575f",
                                "operator": "+=",
                                "value": "1"
                            }
                        ]
                    },
                    {
                        "text": "获得3把绿钥匙、200领悟、3破",
                        "color": [
                            118,
                            209,
                            125,
                            1
                        ],
                        "need": "flag:575f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "operator": "+=",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "status:money",
                                "operator": "+=",
                                "value": "200"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:575f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "3"
                            }
                        ]
                    },
                    {
                        "text": "获得400领悟、6破",
                        "color": [
                            167,
                            217,
                            167,
                            1
                        ],
                        "need": "flag:575f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "status:money",
                                "operator": "+=",
                                "value": "400"
                            },
                            {
                                "type": "setValue",
                                "name": "item:pickaxe",
                                "operator": "+=",
                                "value": "6"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:575f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "6"
                            }
                        ]
                    },
                    {
                        "text": "离去…",
                        "action": []
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "11,1": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "2,5": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [380560,380561,380562,380527,380552,380553,380553,380553,380553,380554,380568,380569,380569],
    [380568,380569,380570,985,380560,380561,380561,380561,380561,380562,1049, 88,1049],
    [1053,1568,640,1575,380568,380569,380569,380569,380569,380570,1049,  0,1050],
    [1049, 81, 16,643,1051,638,1571,1009, 22, 83, 21,1567,1052],
    [1053,1569,  0,1049,1010,1049,1015,1052,1049,642,1049,  0,1053],
    [1049,  0, 87,638,1576,  0,1569, 82,1010,1570,1009,1564,1049],
    [1050,1568,1049,1049, 82,640,1053,1569,1049,191,191,191,191],
    [1049, 21,1570,1051,639,1049,1564,  0,191,191,192,192,192],
    [1052,1049, 22,1570, 16,  0, 21,191,191,192,192,193,193],
    [644,1050, 81,1049,639,191,191,191,192,192,193,193,193],
    [1572,  0,1567,  0,1567,191,192,192,192,193,193,194,194],
    [380541,380542,380543, 21,191,191,192,193,193,193,194,194,194],
    [380549,380550,380551,1049,191,192,192,193,193,194,194,194,194]
],
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,380517,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,380525,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,380500],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "bg2map": [

],
    "fg2map": [

]
}